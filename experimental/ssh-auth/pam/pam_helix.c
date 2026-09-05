// SPDX-License-Identifier: AGPL-3.0-only
/*
 * pam_helix — a PAM conversation relay for Helix device authentication.
 *
 * This module is deliberately, aggressively minimal. It contains no HTTP, no
 * cryptography, no policy, no database and no knowledge of the authentication
 * methods. It opens a root-only Unix socket to helix-authd, relays what the
 * daemon asks to display or prompt for, sends back what the user typed, and
 * translates one terminal result into a PAM return code.
 *
 * Everything it does runs inside sshd's address space, which is precisely why
 * nothing else belongs here.
 *
 * Every failure path returns a denial: there is no path through this file that
 * grants authentication without an explicit "approved" result from the daemon.
 */

/* strdup and explicit_bzero are glibc/POSIX extensions under a strict -std=c11. */
#define _GNU_SOURCE

#include <errno.h>
#include <jansson.h>
#include <security/pam_modules.h>
#include <security/pam_ext.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <syslog.h>
#include <sys/random.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <sys/un.h>
#include <time.h>
#include <unistd.h>

#define HELIX_PROTOCOL_VERSION 1
#define HELIX_MAX_MESSAGE 16384
#define HELIX_DEFAULT_SOCKET "/run/helix/authd/auth.sock"
#define HELIX_DEFAULT_TIMEOUT_SEC 300

struct helix_options {
    const char *socket_path;
    int timeout_sec;
};

/* A line-oriented reader over the socket: helix-authd frames are newline
 * delimited JSON, and a frame larger than the cap is refused rather than
 * reassembled.
 *
 * The daemon may write several frames back to back (a display followed by the
 * prompt it belongs to), and a stream socket will hand them over in a single
 * read, so whatever follows the newline must stay buffered for the next call. */
struct helix_reader {
    int fd;
    char buf[HELIX_MAX_MESSAGE + 1];
    size_t len;
    char line[HELIX_MAX_MESSAGE + 1];
};

static void helix_parse_options(int argc, const char **argv, struct helix_options *opts)
{
    opts->socket_path = HELIX_DEFAULT_SOCKET;
    opts->timeout_sec = HELIX_DEFAULT_TIMEOUT_SEC;

    for (int i = 0; i < argc; i++) {
        if (strncmp(argv[i], "socket=", 7) == 0) {
            opts->socket_path = argv[i] + 7;
        } else if (strncmp(argv[i], "timeout=", 8) == 0) {
            int parsed = atoi(argv[i] + 8);
            if (parsed > 0) {
                opts->timeout_sec = parsed;
            }
        }
    }
}

/* helix_connect returns a connected socket, or -1. */
static int helix_connect(pam_handle_t *pamh, const struct helix_options *opts)
{
    struct sockaddr_un addr;
    if (strlen(opts->socket_path) >= sizeof(addr.sun_path)) {
        pam_syslog(pamh, LOG_ERR, "socket path too long: %s", opts->socket_path);
        return -1;
    }

    int fd = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
    if (fd < 0) {
        pam_syslog(pamh, LOG_ERR, "socket(): %s", strerror(errno));
        return -1;
    }

    memset(&addr, 0, sizeof(addr));
    addr.sun_family = AF_UNIX;
    strncpy(addr.sun_path, opts->socket_path, sizeof(addr.sun_path) - 1);

    if (connect(fd, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        pam_syslog(pamh, LOG_ERR, "connect(%s): %s", opts->socket_path, strerror(errno));
        close(fd);
        return -1;
    }

    /* Bound every read and write so a wedged daemon cannot hang sshd until the
     * login grace period expires. */
    struct timeval tv = { .tv_sec = opts->timeout_sec, .tv_usec = 0 };
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));
    return fd;
}

static int helix_write_all(int fd, const char *data, size_t len)
{
    size_t off = 0;
    while (off < len) {
        ssize_t n = write(fd, data + off, len - off);
        if (n < 0) {
            if (errno == EINTR) {
                continue;
            }
            return -1;
        }
        off += (size_t)n;
    }
    return 0;
}

/* helix_send_json serialises and writes one newline-terminated frame. */
static int helix_send_json(pam_handle_t *pamh, int fd, json_t *msg)
{
    char *encoded = json_dumps(msg, JSON_COMPACT);
    if (encoded == NULL) {
        pam_syslog(pamh, LOG_ERR, "could not encode message");
        return -1;
    }

    size_t len = strlen(encoded);
    int rc = -1;
    if (len + 1 > HELIX_MAX_MESSAGE) {
        pam_syslog(pamh, LOG_ERR, "outgoing message too large");
    } else if (helix_write_all(fd, encoded, len) == 0 && helix_write_all(fd, "\n", 1) == 0) {
        rc = 0;
    }

    free(encoded);
    return rc;
}

/* helix_read_line reads one frame into *line (NUL terminated, no newline).
 * Returns 0 on success, -1 on error or an oversized frame. */
static int helix_read_line(pam_handle_t *pamh, struct helix_reader *r, char **line)
{
    for (;;) {
        char *newline = memchr(r->buf, '\n', r->len);
        if (newline != NULL) {
            size_t line_len = (size_t)(newline - r->buf);
            memcpy(r->line, r->buf, line_len);
            r->line[line_len] = '\0';

            /* Keep whatever followed the newline: it is the next frame. */
            size_t consumed = line_len + 1;
            memmove(r->buf, r->buf + consumed, r->len - consumed);
            r->len -= consumed;

            *line = r->line;
            return 0;
        }
        if (r->len >= HELIX_MAX_MESSAGE) {
            pam_syslog(pamh, LOG_ERR, "incoming message exceeds %d bytes", HELIX_MAX_MESSAGE);
            return -1;
        }

        ssize_t n = read(r->fd, r->buf + r->len, HELIX_MAX_MESSAGE - r->len);
        if (n < 0) {
            if (errno == EINTR) {
                continue;
            }
            pam_syslog(pamh, LOG_ERR, "read(): %s", strerror(errno));
            return -1;
        }
        if (n == 0) {
            pam_syslog(pamh, LOG_ERR, "helix-authd closed the connection");
            return -1;
        }
        r->len += (size_t)n;
    }
}

/* helix_converse runs one PAM conversation turn. *response is allocated by the
 * application and must be freed by the caller. */
static int helix_converse(pam_handle_t *pamh, int style, const char *text, char **response)
{
    const void *item = NULL;
    if (pam_get_item(pamh, PAM_CONV, &item) != PAM_SUCCESS || item == NULL) {
        return -1;
    }
    const struct pam_conv *conv = (const struct pam_conv *)item;
    if (conv->conv == NULL) {
        return -1;
    }

    struct pam_message msg = { .msg_style = style, .msg = text };
    const struct pam_message *msgp = &msg;
    struct pam_response *resp = NULL;

    if (conv->conv(1, &msgp, &resp, conv->appdata_ptr) != PAM_SUCCESS) {
        return -1;
    }
    if (response == NULL) {
        /* Display styles carry no reply, but a conversation may still allocate. */
        if (resp != NULL) {
            free(resp->resp);
            free(resp);
        }
        return 0;
    }
    if (resp == NULL) {
        return -1;
    }

    *response = resp->resp != NULL ? resp->resp : strdup("");
    free(resp);
    return *response != NULL ? 0 : -1;
}

/* Pending display text, flushed as a prefix to the next prompt.
 *
 * OpenSSH's PAM keyboard-interactive bridge does not reliably deliver a round
 * that carries only informational text: sshd sends an INFO_REQUEST with zero
 * prompts, the client answers with zero responses, and the conversation stalls
 * (observed as "input_userauth_info_req: num_prompts 0" followed by a hang).
 * Folding the text into the next prompt is what PAM modules that need to show
 * something before asking a question conventionally do, and it keeps the daemon
 * free to speak in the display/prompt events the protocol defines. */
struct helix_display_buffer {
    char text[HELIX_MAX_MESSAGE];
    size_t len;
    int had_error;
};

static void helix_display_append(struct helix_display_buffer *buf, const char *text, int is_error)
{
    if (text == NULL || *text == '\0') {
        return;
    }
    if (is_error) {
        buf->had_error = 1;
    }

    size_t text_len = strlen(text);
    /* Leave room for the separating newline and the terminator. */
    if (buf->len + text_len + 2 > sizeof(buf->text)) {
        text_len = sizeof(buf->text) - buf->len - 2;
    }
    if ((ssize_t)text_len <= 0) {
        return;
    }

    memcpy(buf->text + buf->len, text, text_len);
    buf->len += text_len;
    buf->text[buf->len++] = '\n';
    buf->text[buf->len] = '\0';
}

static void helix_display_reset(struct helix_display_buffer *buf)
{
    buf->len = 0;
    buf->had_error = 0;
    buf->text[0] = '\0';
}

/* helix_status_to_pam maps a terminal result onto a PAM return code. Anything
 * unrecognised denies. */
static int helix_status_to_pam(const char *status)
{
    if (status == NULL) {
        return PAM_AUTH_ERR;
    }
    if (strcmp(status, "approved") == 0) {
        return PAM_SUCCESS;
    }
    if (strcmp(status, "unavailable") == 0 || strcmp(status, "protocol_error") == 0) {
        return PAM_AUTHINFO_UNAVAIL;
    }
    /* denied, expired, invalid_credential and anything unknown. */
    return PAM_AUTH_ERR;
}

/* helix_request_id returns a random hex id for correlating logs. */
static void helix_request_id(char *out, size_t out_len)
{
    unsigned char raw[16];
    if (getrandom(raw, sizeof(raw), 0) != (ssize_t)sizeof(raw)) {
        snprintf(out, out_len, "req-%ld", (long)time(NULL));
        return;
    }
    static const char hex[] = "0123456789abcdef";
    size_t i = 0;
    for (; i < sizeof(raw) && (i * 2 + 2) < out_len; i++) {
        out[i * 2] = hex[raw[i] >> 4];
        out[i * 2 + 1] = hex[raw[i] & 0x0f];
    }
    out[i * 2] = '\0';
}

/* helix_run_conversation drives frames until a result arrives. */
static int helix_run_conversation(pam_handle_t *pamh, struct helix_reader *reader, int fd)
{
    struct helix_display_buffer pending;
    helix_display_reset(&pending);

    for (;;) {
        char *line = NULL;
        if (helix_read_line(pamh, reader, &line) != 0) {
            return PAM_AUTHINFO_UNAVAIL;
        }

        json_error_t err;
        json_t *msg = json_loads(line, 0, &err);
        if (msg == NULL) {
            pam_syslog(pamh, LOG_ERR, "malformed message from helix-authd");
            return PAM_AUTHINFO_UNAVAIL;
        }

        json_int_t version = json_integer_value(json_object_get(msg, "version"));
        const char *type = json_string_value(json_object_get(msg, "type"));
        if (version != HELIX_PROTOCOL_VERSION || type == NULL) {
            pam_syslog(pamh, LOG_ERR, "unsupported protocol version from helix-authd");
            json_decref(msg);
            return PAM_AUTHINFO_UNAVAIL;
        }

        int rc = -1;
        if (strcmp(type, "result") == 0) {
            const char *status = json_string_value(json_object_get(msg, "status"));
            rc = helix_status_to_pam(status);
            json_decref(msg);
            /* Nothing follows a result, so anything still buffered is delivered
             * on its own; a client that drops it loses only trailing text. */
            if (pending.len > 0) {
                helix_converse(pamh, pending.had_error ? PAM_ERROR_MSG : PAM_TEXT_INFO,
                               pending.text, NULL);
            }
            return rc;
        }

        if (strcmp(type, "display") == 0) {
            const char *level = json_string_value(json_object_get(msg, "level"));
            const char *text = json_string_value(json_object_get(msg, "text"));
            helix_display_append(&pending, text, level != NULL && strcmp(level, "error") == 0);
            json_decref(msg);
            continue;
        }

        if (strcmp(type, "prompt") == 0) {
            const char *prompt_id = json_string_value(json_object_get(msg, "prompt_id"));
            const char *text = json_string_value(json_object_get(msg, "text"));
            int secret = json_is_true(json_object_get(msg, "secret"));
            int style = secret ? PAM_PROMPT_ECHO_OFF : PAM_PROMPT_ECHO_ON;

            if (prompt_id == NULL) {
                json_decref(msg);
                return PAM_AUTHINFO_UNAVAIL;
            }

            /* Prefix anything the daemon asked to display since the last prompt. */
            char prompt_text[HELIX_MAX_MESSAGE];
            snprintf(prompt_text, sizeof(prompt_text), "%s%s",
                     pending.text, text != NULL ? text : "");
            helix_display_reset(&pending);

            char *answer = NULL;
            rc = helix_converse(pamh, style, prompt_text, &answer);
            if (rc != 0 || answer == NULL) {
                json_decref(msg);
                return PAM_AUTH_ERR;
            }

            json_t *reply = json_pack("{s:i, s:s, s:s, s:s}",
                                      "version", HELIX_PROTOCOL_VERSION,
                                      "type", "prompt_response",
                                      "prompt_id", prompt_id,
                                      "value", answer);
            int sent = reply != NULL ? helix_send_json(pamh, fd, reply) : -1;

            /* The answer may be a pasted credential; do not leave it in memory. */
            explicit_bzero(answer, strlen(answer));
            free(answer);
            if (reply != NULL) {
                json_decref(reply);
            }
            json_decref(msg);

            if (sent != 0) {
                return PAM_AUTHINFO_UNAVAIL;
            }
            continue;
        }

        pam_syslog(pamh, LOG_ERR, "unexpected message type from helix-authd: %s", type);
        json_decref(msg);
        return PAM_AUTHINFO_UNAVAIL;
    }
}

PAM_EXTERN int pam_sm_authenticate(pam_handle_t *pamh, int flags, int argc, const char **argv)
{
    (void)flags;

    struct helix_options opts;
    helix_parse_options(argc, argv, &opts);

    const char *username = NULL;
    if (pam_get_user(pamh, &username, NULL) != PAM_SUCCESS || username == NULL || *username == '\0') {
        pam_syslog(pamh, LOG_ERR, "could not determine username");
        return PAM_AUTH_ERR;
    }

    const void *service_item = NULL;
    const void *rhost_item = NULL;
    pam_get_item(pamh, PAM_SERVICE, &service_item);
    pam_get_item(pamh, PAM_RHOST, &rhost_item);

    int fd = helix_connect(pamh, &opts);
    if (fd < 0) {
        /* No daemon means no authentication. There is no local fallback. */
        return PAM_AUTHINFO_UNAVAIL;
    }

    char request_id[33];
    helix_request_id(request_id, sizeof(request_id));

    json_t *start = json_pack("{s:i, s:s, s:s, s:s, s:s, s:s}",
                              "version", HELIX_PROTOCOL_VERSION,
                              "type", "start",
                              "request_id", request_id,
                              "username", username,
                              "pam_service", service_item != NULL ? (const char *)service_item : "",
                              "rhost", rhost_item != NULL ? (const char *)rhost_item : "");
    if (start == NULL || helix_send_json(pamh, fd, start) != 0) {
        if (start != NULL) {
            json_decref(start);
        }
        close(fd);
        return PAM_AUTHINFO_UNAVAIL;
    }
    json_decref(start);

    struct helix_reader reader = { .fd = fd, .len = 0 };
    int rc = helix_run_conversation(pamh, &reader, fd);

    close(fd);
    return rc;
}

PAM_EXTERN int pam_sm_setcred(pam_handle_t *pamh, int flags, int argc, const char **argv)
{
    (void)pamh; (void)flags; (void)argc; (void)argv;
    return PAM_SUCCESS;
}

PAM_EXTERN int pam_sm_acct_mgmt(pam_handle_t *pamh, int flags, int argc, const char **argv)
{
    (void)pamh; (void)flags; (void)argc; (void)argv;
    return PAM_SUCCESS;
}
