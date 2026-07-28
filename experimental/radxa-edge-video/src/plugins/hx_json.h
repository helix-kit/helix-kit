// SPDX-License-Identifier: AGPL-3.0-only
// hx_json — tiny header-only JSON parser + dumper. Deliberately minimal: the 1 GB board
// OOM-kills heavy header libs like nlohmann/json.
#ifndef HX_JSON_H
#define HX_JSON_H

#include <string>
#include <vector>
#include <utility>
#include <cstdlib>
#include <cstring>
#include <cstdio>

namespace hxj {

struct Value {
    enum Type { Null, Bool, Num, Str, Arr, Obj } type = Null;
    bool b = false;
    double num = 0;
    std::string str;
    std::vector<Value> arr;
    std::vector<std::pair<std::string, Value>> obj;

    const Value *get(const char *k) const {
        if (type == Obj)
            for (auto &kv : obj)
                if (kv.first == k) return &kv.second;
        return nullptr;
    }
    const Value *at(size_t i) const { return (type == Arr && i < arr.size()) ? &arr[i] : nullptr; }
    size_t size() const { return type == Arr ? arr.size() : (type == Obj ? obj.size() : 0); }
    std::string as_str(const char *d = "") const { return type == Str ? str : std::string(d); }
    double as_num(double d = 0) const { return type == Num ? num : (type == Bool ? (b ? 1 : 0) : d); }
    int as_int(int d = 0) const { return type == Num ? (int)num : d; }
    bool as_bool(bool d = false) const { return type == Bool ? b : d; }
};

namespace detail {
inline void skip_ws(const char *&p) {
    while (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r') p++;
}
inline bool parse_val(const char *&p, Value &out);
inline bool parse_str(const char *&p, std::string &s) {
    if (*p != '"') return false;
    p++;
    while (*p && *p != '"') {
        if (*p == '\\') {
            p++;
            switch (*p) {
                case 'n': s += '\n'; break;
                case 't': s += '\t'; break;
                case 'r': s += '\r'; break;
                case 'b': s += '\b'; break;
                case 'f': s += '\f'; break;
                case '/': s += '/'; break;
                case '\\': s += '\\'; break;
                case '"': s += '"'; break;
                default: s += *p; break;   // \uXXXX not supported; pass through
            }
            p++;
        } else {
            s += *p++;
        }
    }
    if (*p != '"') return false;
    p++;
    return true;
}
inline bool parse_val(const char *&p, Value &out) {
    skip_ws(p);
    if (*p == '"') {
        out.type = Value::Str;
        return parse_str(p, out.str);
    }
    if (*p == '{') {
        out.type = Value::Obj;
        p++;
        skip_ws(p);
        if (*p == '}') { p++; return true; }
        for (;;) {
            skip_ws(p);
            std::string key;
            if (!parse_str(p, key)) return false;
            skip_ws(p);
            if (*p != ':') return false;
            p++;
            Value v;
            if (!parse_val(p, v)) return false;
            out.obj.emplace_back(std::move(key), std::move(v));
            skip_ws(p);
            if (*p == ',') { p++; continue; }
            if (*p == '}') { p++; return true; }
            return false;
        }
    }
    if (*p == '[') {
        out.type = Value::Arr;
        p++;
        skip_ws(p);
        if (*p == ']') { p++; return true; }
        for (;;) {
            Value v;
            if (!parse_val(p, v)) return false;
            out.arr.push_back(std::move(v));
            skip_ws(p);
            if (*p == ',') { p++; continue; }
            if (*p == ']') { p++; return true; }
            return false;
        }
    }
    if (!strncmp(p, "true", 4)) { out.type = Value::Bool; out.b = true; p += 4; return true; }
    if (!strncmp(p, "false", 5)) { out.type = Value::Bool; out.b = false; p += 5; return true; }
    if (!strncmp(p, "null", 4)) { out.type = Value::Null; p += 4; return true; }
    char *end = nullptr;
    double d = strtod(p, &end);
    if (end == p) return false;
    out.type = Value::Num;
    out.num = d;
    p = end;
    return true;
}
inline void dump_str(const std::string &s, std::string &o) {
    o += '"';
    for (char c : s) {
        switch (c) {
            case '"': o += "\\\""; break;
            case '\\': o += "\\\\"; break;
            case '\n': o += "\\n"; break;
            case '\t': o += "\\t"; break;
            case '\r': o += "\\r"; break;
            default: o += c; break;
        }
    }
    o += '"';
}
inline void dump_val(const Value &v, std::string &o) {
    switch (v.type) {
        case Value::Null: o += "null"; break;
        case Value::Bool: o += v.b ? "true" : "false"; break;
        case Value::Num: {
            char buf[32];
            if (v.num == (long long)v.num) snprintf(buf, sizeof(buf), "%lld", (long long)v.num);
            else snprintf(buf, sizeof(buf), "%g", v.num);
            o += buf;
            break;
        }
        case Value::Str: dump_str(v.str, o); break;
        case Value::Arr: {
            o += '[';
            for (size_t i = 0; i < v.arr.size(); i++) { if (i) o += ','; dump_val(v.arr[i], o); }
            o += ']';
            break;
        }
        case Value::Obj: {
            o += '{';
            for (size_t i = 0; i < v.obj.size(); i++) {
                if (i) o += ',';
                dump_str(v.obj[i].first, o);
                o += ':';
                dump_val(v.obj[i].second, o);
            }
            o += '}';
            break;
        }
    }
}
} // namespace detail

inline Value parse(const char *s, bool *ok = nullptr) {
    Value v;
    const char *p = s;
    bool r = detail::parse_val(p, v);
    if (ok) *ok = r;
    return v;
}
inline std::string dump(const Value &v) {
    std::string o;
    detail::dump_val(v, o);
    return o;
}

// convenience accessors on an object Value with defaults
inline std::string jstr(const Value &v, const char *k, const char *def = "") {
    auto p = v.get(k);
    return p ? p->as_str(def) : std::string(def);
}
inline double jnum(const Value &v, const char *k, double def = 0) {
    auto p = v.get(k);
    return p ? p->as_num(def) : def;
}
inline int jint(const Value &v, const char *k, int def = 0) {
    auto p = v.get(k);
    return p ? p->as_int(def) : def;
}
inline bool jbool(const Value &v, const char *k, bool def = false) {
    auto p = v.get(k);
    return p ? p->as_bool(def) : def;
}

} // namespace hxj

#endif // HX_JSON_H
