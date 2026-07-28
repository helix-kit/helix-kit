#pragma once

#include <stdbool.h>
#include <stddef.h>

#include "cJSON.h"
#include "esp_err.h"

#define HELIX_PROVISIONING_SERVICE "provisioning"
#define HELIX_PROVISIONING_DESCRIBE_CONFIG_METHOD "describe-config"
#define HELIX_PROVISIONING_GET_CONFIG_METHOD "get-config"
#define HELIX_PROVISIONING_SET_CONFIG_METHOD "set-config"
#define HELIX_PROVISIONING_CONFIG_MESSAGE "provisioning-config"
#define HELIX_PROVISIONING_STATUS_MESSAGE "provisioning-status"

typedef struct {
    const char *key;
    const char *label;
    bool required;
    bool secret;
} helix_provisioning_field_t;

typedef esp_err_t (*helix_provisioning_validate_fn_t)(
    const char *domain,
    const cJSON *values,
    bool force,
    void *context
);

typedef struct {
    const char *domain;
    const char *label;
    const helix_provisioning_field_t *fields;
    size_t field_count;
    bool restart_required;
    helix_provisioning_validate_fn_t validate;
    void *context;
} helix_provisioning_domain_t;

esp_err_t helix_provisioning_register_domain(const helix_provisioning_domain_t *domain);
esp_err_t helix_provisioning_start(void);
