from __future__ import annotations

import json
import keyword
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any

import click

_JS_IDENTIFIER = re.compile(r"^[A-Za-z_$][A-Za-z0-9_$]*$")


def _ts_key(name: str) -> str:
    return name if _JS_IDENTIFIER.match(name) else json.dumps(name)


SUPPORTED_TARGETS = ("typescript", "python", "go", "cpp", "embedded-c")
RESERVED_PAYLOAD_FIELDS = {"requestid", "requesttype"}


def _load_contract(source: Path) -> dict[str, Any]:
    data = _read_contract_json(source)
    if not isinstance(data, dict):
        raise click.ClickException("Contract source must be a JSON object.")
    _apply_includes(data, source)
    _validate_contract_data(data)
    return data


def _read_contract_json(source: Path) -> Any:
    try:
        return json.loads(source.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise click.ClickException(f"Invalid JSON contract: {exc}") from exc


def _apply_includes(data: dict[str, Any], source: Path) -> None:
    """Merge shared contract fragments (schemas/methods + `extends` field groups) into a contract."""
    includes = data.pop("includes", [])
    if not isinstance(includes, list):
        raise click.ClickException("Contract includes must be an array when provided.")

    for include in includes:
        if not isinstance(include, dict):
            raise click.ClickException("Each contract include must be an object.")
        path = include.get("path")
        if not isinstance(path, str) or path.strip() == "":
            raise click.ClickException("Contract include must define a non-empty string path.")
        fragment_path = (source.parent / path).resolve()
        if not fragment_path.is_file():
            raise click.ClickException(f"Contract include not found: {fragment_path}")
        fragment = _read_contract_json(fragment_path)
        if not isinstance(fragment, dict):
            raise click.ClickException(f"Contract fragment must be a JSON object: {fragment_path}")

        schemas = data.setdefault("schemas", {})
        methods = data.setdefault("methods", {})
        for section, target in (("schemas", schemas), ("methods", methods)):
            for key, value in fragment.get(section, {}).items():
                if key in target:
                    raise click.ClickException(
                        f"Contract include {path} redefines existing {section[:-1]} {key}."
                    )
                target[key] = value

        extends = include.get("extends", {})
        if not isinstance(extends, dict):
            raise click.ClickException(f"Contract include {path} extends must be an object.")
        for role, fields in fragment.get("extends", {}).items():
            schema_name = extends.get(role)
            if schema_name is None:
                raise click.ClickException(
                    f"Contract include {path} requires a schema for role {role}."
                )
            schema = schemas.get(schema_name)
            if not isinstance(schema, dict):
                raise click.ClickException(
                    f"Contract include {path} extends unknown schema {schema_name}."
                )
            for field_name, definition in fields.items():
                if field_name in schema:
                    raise click.ClickException(
                        f"Contract include {path} redefines field {schema_name}.{field_name}."
                    )
                schema[field_name] = definition


def _validate_contract_data(data: dict[str, Any]) -> None:
    service = data.get("service")
    if not isinstance(service, str) or service.strip() == "":
        raise click.ClickException("Contract must define a non-empty string field: service.")

    methods = data.get("methods")
    if not isinstance(methods, dict):
        raise click.ClickException("Contract must define an object field: methods.")

    for method_key, method_definition in methods.items():
        if not isinstance(method_key, str) or method_key.strip() == "":
            raise click.ClickException("Method keys must be non-empty strings.")
        if not isinstance(method_definition, dict):
            raise click.ClickException(f"Method {method_key} must be an object.")
        name = method_definition.get("name")
        if not isinstance(name, str) or name.strip() == "":
            raise click.ClickException(f"Method {method_key} must define a non-empty name.")
        output_name = method_definition.get("outputName")
        if output_name is not None and (
            not isinstance(output_name, str) or output_name.strip() == ""
        ):
            raise click.ClickException(
                f"Method {method_key}.outputName must be a non-empty string when provided."
            )
        for schema_field in ("input", "output", "error"):
            schema_name = method_definition.get(schema_field)
            if schema_name is not None and not isinstance(schema_name, str):
                raise click.ClickException(
                    f"Method {method_key}.{schema_field} must name a schema."
                )

    messages = data.get("messages", {})
    if not isinstance(messages, dict):
        raise click.ClickException("Contract messages must be an object when provided.")
    for message_key, message_definition in messages.items():
        if not isinstance(message_key, str) or message_key.strip() == "":
            raise click.ClickException("Message keys must be non-empty strings.")
        if not isinstance(message_definition, dict):
            raise click.ClickException(f"Message {message_key} must be an object.")
        name = message_definition.get("name")
        if not isinstance(name, str) or name.strip() == "":
            raise click.ClickException(f"Message {message_key} must define a non-empty name.")
        payload_schema = message_definition.get("payload")
        if payload_schema is not None and not isinstance(payload_schema, str):
            raise click.ClickException(f"Message {message_key}.payload must name a schema.")

    schemas = data.get("schemas", {})
    if not isinstance(schemas, dict):
        raise click.ClickException("Contract schemas must be an object when provided.")
    for schema_name, fields in schemas.items():
        if not isinstance(fields, dict):
            raise click.ClickException(f"Schema {schema_name} must be an object.")
        for field_name in fields:
            normalized = str(field_name).replace("_", "").lower()
            if normalized in RESERVED_PAYLOAD_FIELDS:
                raise click.ClickException(
                    f"Schema {schema_name} contains reserved protocol field {field_name}."
                )

    for method_key, method_definition in methods.items():
        for schema_field in ("input", "output", "error"):
            schema_name = method_definition.get(schema_field)
            if schema_name is not None and schema_name not in schemas:
                raise click.ClickException(
                    f"Method {method_key}.{schema_field} references unknown schema {schema_name}."
                )
    for message_key, message_definition in messages.items():
        schema_name = message_definition.get("payload")
        if schema_name is not None and schema_name not in schemas:
            raise click.ClickException(
                f"Message {message_key}.payload references unknown schema {schema_name}."
            )


def _identifier(value: str) -> str:
    parts = value.replace("-", "_").split("_")
    head, *tail = [part for part in parts if part]
    return head + "".join(part[:1].upper() + part[1:] for part in tail)


def _snake(value: str) -> str:
    out: list[str] = []
    previous_lower = False
    for char in value.replace("-", "_"):
        if char == "_":
            out.append("_")
            previous_lower = False
            continue
        if char.isupper() and previous_lower:
            out.append("_")
        out.append(char.lower())
        previous_lower = char.islower() or char.isdigit()
    return "".join(out).strip("_")


def _macro(value: str) -> str:
    return _snake(value).upper()


def _pascal(value: str) -> str:
    parts = [part for part in value.replace("-", "_").split("_") if part]
    return "".join(part[:1].upper() + part[1:] for part in parts)


def _schemas_in_dependency_order(schemas: dict[str, Any]) -> list[tuple[str, Any]]:
    """Order schemas so each is emitted after those it references: TS consts aren't hoisted (TDZ)."""
    ordered: list[tuple[str, Any]] = []
    emitted: set[str] = set()
    visiting: set[str] = set()

    def visit(name: str) -> None:
        if name in emitted or name not in schemas:
            return
        if name in visiting:
            raise click.ClickException(f"Contract schemas form a reference cycle at {name}.")
        visiting.add(name)
        fields = schemas[name]
        if isinstance(fields, dict):
            for definition in fields.values():
                if isinstance(definition, dict):
                    item = definition.get("items")
                    if isinstance(item, str):
                        visit(item)
        visiting.discard(name)
        emitted.add(name)
        ordered.append((name, fields))

    for schema_name in schemas:
        visit(schema_name)
    return ordered


def _typescript_contract(data: dict[str, Any]) -> str:
    service_name = data["service"]
    const_name = _identifier(service_name)
    methods = data["methods"]
    messages = data.get("messages", {})

    schemas = data.get("schemas", {})
    imported = ["defineServiceContract", "method"]
    if messages:
        imported.append("message")
    lines = [
        f"import {{ {', '.join(imported)} }} from '@helix/protocol-service';",
        "import { z } from 'zod';",
        "",
    ]

    for schema_name, fields in _schemas_in_dependency_order(schemas):
        const_decl = f"export const {_identifier(schema_name)}Schema = z.object({{"
        if not fields:
            lines.extend([f"{const_decl}}});", ""])
            continue
        lines.append(const_decl)
        for field_name, definition in fields.items():
            field_type, required = _embedded_c_field_spec(schema_name, field_name, definition)
            schema_expression = _typescript_schema_expression(field_type, definition)
            if not required:
                schema_expression += ".optional()"
            lint_comment = (
                " // eslint-disable-line no-magic-numbers"
                if _typescript_field_has_magic_number(definition)
                else ""
            )
            lines.append(f"  {_ts_key(field_name)}: {schema_expression},{lint_comment}")
        lines.extend(["});", ""])

    lines.extend(
        [
            f"export const {const_name}Contract = defineServiceContract({{",
            f"  service: {service_name!r},",
            "  methods: {",
        ]
    )

    for key, definition in methods.items():
        lines.extend(
            [
                f"    {_ts_key(key)}: method({{",
                f"      name: {definition['name']!r},",
                f"      input: {_typescript_schema_reference(definition.get('input'))},",
                f"      output: {_typescript_schema_reference(definition.get('output'))},",
                f"      error: {_typescript_schema_reference(definition.get('error'))},",
                "    }),",
            ]
        )

    lines.append("  },")
    if messages:
        lines.append("  messages: {")
        for key, definition in messages.items():
            lines.extend(
                [
                    f"    {_ts_key(key)}: message({{",
                    f"      name: {definition['name']!r},",
                    f"      payload: {_typescript_schema_reference(definition.get('payload'))},",
                    "    }),",
                ]
            )
        lines.append("  },")
    lines.extend(["});", ""])
    return "\n".join(lines)


def _typescript_schema_reference(schema_name: Any) -> str:
    if not isinstance(schema_name, str):
        return "z.unknown()"
    return f"{_identifier(schema_name)}Schema"


def _typescript_schema_expression(field_type: str, definition: Any) -> str:
    if field_type == "string":
        expression = "z.string()"
    elif field_type == "number":
        expression = "z.number()"
    elif field_type == "boolean":
        expression = "z.boolean()"
    elif field_type == "json":
        expression = "z.unknown()"
    elif field_type == "array":
        if not isinstance(definition, dict) or not isinstance(definition.get("items"), str):
            raise click.ClickException(
                "TypeScript array fields must define a type or schema name in items."
            )
        items = definition["items"]
        if items in ("string", "number", "boolean"):
            expression = f"z.array(z.{items}())"
        elif items == "json":
            expression = "z.array(z.unknown())"
        else:
            expression = f"z.array({_identifier(items)}Schema)"
    else:
        raise click.ClickException(f"Unsupported TypeScript field type: {field_type}")

    if isinstance(definition, dict):
        if definition.get("integer") is True and field_type == "number":
            expression += ".int()"
        if isinstance(definition.get("minimum"), (int, float)):
            expression += f".min({definition['minimum']})"
        if isinstance(definition.get("maximum"), (int, float)):
            expression += f".max({definition['maximum']})"
    return expression


def _typescript_field_has_magic_number(definition: Any) -> bool:
    if not isinstance(definition, dict):
        return False
    ignored_numbers = {-1, 0, 1, 2}
    return any(
        isinstance(definition.get(constraint), (int, float))
        and definition[constraint] not in ignored_numbers
        for constraint in ("minimum", "maximum")
    )


_PRIMITIVE_TYPES = ("string", "number", "boolean", "json")


def _method_io_schemas(method_key: str, definition: dict[str, Any]) -> tuple[str, str]:
    input_schema = definition.get("input")
    output_schema = definition.get("output")
    if not isinstance(input_schema, str) or not isinstance(output_schema, str):
        raise click.ClickException(
            f"Method {method_key} must name both input and output schemas for Go/Python targets."
        )
    return input_schema, output_schema


def _gofmt(source: str) -> str:
    gofmt = shutil.which("gofmt")
    if gofmt is None:
        return source
    # Separate handlers, not a tuple: `except (A, B):` reformats to a PEP 758 SyntaxError on 3.12.
    try:
        result = subprocess.run([gofmt], input=source, capture_output=True, text=True, check=True)
    except OSError:
        return source
    except subprocess.CalledProcessError:
        return source
    return result.stdout


def _go_struct_name(service: str, schema_name: str) -> str:
    return _pascal(service) + _pascal(schema_name)


def _go_type_expr(service: str, field_type: str, definition: Any) -> str:
    if field_type == "string":
        return "string"
    if field_type == "boolean":
        return "bool"
    if field_type == "number":
        if isinstance(definition, dict) and definition.get("integer") is True:
            return "int"
        return "float64"
    if field_type == "json":
        return "json.RawMessage"
    if field_type == "array":
        item = definition.get("items") if isinstance(definition, dict) else None
        if not isinstance(item, str):
            raise click.ClickException(
                "Go array fields must define a type or schema name in items."
            )
        if item in _PRIMITIVE_TYPES:
            return "[]" + _go_type_expr(service, item, {})
        return "[]" + _go_struct_name(service, item)
    raise click.ClickException(f"Unsupported Go field type: {field_type}")


def _go_contract(data: dict[str, Any]) -> str:
    service = data["service"]
    svc = _pascal(service)
    schemas = data.get("schemas", {})
    methods = data["methods"]
    messages = data.get("messages", {})

    lines = [
        "// SPDX-License-Identifier: AGPL-3.0-only",
        "",
        "// Code generated by `uv run helix protocol generate --target go`. DO NOT EDIT.",
        "",
        "package generated",
        "",
        "import (",
        '\t"context"',
        '\t"encoding/json"',
        '\t"fmt"',
        '\t"log/slog"',
        "",
        '\t"github.com/helix-kit/helix-device/internal/ipc"',
        '\t"github.com/helix-kit/helix-device/internal/shared/ipcutil"',
        ")",
        "",
        f"const {svc}Service = {json.dumps(service)}",
        "",
        "const (",
    ]
    for key, definition in methods.items():
        response_name = definition.get("outputName") or definition["name"]
        lines.append(f"\t{svc}{_pascal(key)}Method = {json.dumps(definition['name'])}")
        lines.append(f"\t{svc}{_pascal(key)}ResponseMethod = {json.dumps(response_name)}")
    for key, definition in messages.items():
        lines.append(f"\t{svc}{_pascal(key)}Message = {json.dumps(definition['name'])}")
    lines.extend([")", ""])

    for schema_name, fields in schemas.items():
        struct = _go_struct_name(service, schema_name)
        lines.append(f"type {struct} struct {{")
        for field_name, definition in fields.items():
            field_type, required = _embedded_c_field_spec(schema_name, field_name, definition)
            go_type = _go_type_expr(service, field_type, definition)
            tag = field_name if required else f"{field_name},omitempty"
            lines.append(f'\t{_pascal(field_name)} {go_type} `json:"{tag}"`')
        lines.extend(["}", ""])

    for schema_name in schemas:
        struct = _go_struct_name(service, schema_name)
        lines.extend(
            [
                f"func Parse{struct}(payload json.RawMessage) ({struct}, error) {{",
                f"\tvar out {struct}",
                "\tif len(payload) == 0 {",
                "\t\treturn out, nil",
                "\t}",
                "\tif err := json.Unmarshal(payload, &out); err != nil {",
                f'\t\treturn out, fmt.Errorf("decode {struct}: %w", err)',
                "\t}",
                "\treturn out, nil",
                "}",
                "",
            ]
        )

    lines.append(f"type {svc}Handler interface {{")
    for key, definition in methods.items():
        input_schema, output_schema = _method_io_schemas(key, definition)
        in_type = _go_struct_name(service, input_schema)
        out_type = _go_struct_name(service, output_schema)
        lines.append(
            f"\tHandle{_pascal(key)}(ctx context.Context, req {in_type}) ({out_type}, error)"
        )
    lines.extend(["}", ""])

    lines.extend(
        [
            f"func Dispatch{svc}(ctx context.Context, client *ipc.Client, log *slog.Logger, "
            f"cmd ipc.CommandParams, handler {svc}Handler) {{",
            "\tswitch cmd.Method {",
        ]
    )
    for key, definition in methods.items():
        input_schema, _ = _method_io_schemas(key, definition)
        in_type = _go_struct_name(service, input_schema)
        lines.extend(
            [
                f"\tcase {svc}{_pascal(key)}Method:",
                f"\t\treq, err := Parse{in_type}(cmd.Payload)",
                "\t\tif err != nil {",
                f"\t\t\tipcutil.RespondError(client, log, cmd.RequestID, {svc}Service, "
                "err.Error())",
                "\t\t\treturn",
                "\t\t}",
                f"\t\tout, err := handler.Handle{_pascal(key)}(ctx, req)",
                "\t\tif err != nil {",
                f"\t\t\tipcutil.RespondError(client, log, cmd.RequestID, {svc}Service, "
                "err.Error())",
                "\t\t\treturn",
                "\t\t}",
                f"\t\tipcutil.Respond(client, log, cmd.RequestID, "
                f"{svc}{_pascal(key)}ResponseMethod, out)",
            ]
        )
    lines.extend(
        [
            "\tdefault:",
            f"\t\tipcutil.RespondError(client, log, cmd.RequestID, {svc}Service, "
            f'"unknown command: "+cmd.Method)',
            "\t}",
            "}",
            "",
        ]
    )
    return _gofmt("\n".join(lines))


def _python_type_expr(service: str, field_type: str, definition: Any) -> str:
    if field_type == "string":
        return "str"
    if field_type == "boolean":
        return "bool"
    if field_type == "number":
        if isinstance(definition, dict) and definition.get("integer") is True:
            return "int"
        return "float"
    if field_type == "json":
        return "Any"
    if field_type == "array":
        item = definition.get("items") if isinstance(definition, dict) else None
        if not isinstance(item, str):
            raise click.ClickException(
                "Python array fields must define a type or schema name in items."
            )
        if item in _PRIMITIVE_TYPES:
            return f"List[{_python_type_expr(service, item, {})}]"
        return f"List[{_pascal(service) + _pascal(item)}]"
    raise click.ClickException(f"Unsupported Python field type: {field_type}")


def _python_attr(field_name: str) -> str:
    name = _snake(field_name)
    if keyword.iskeyword(name):
        name += "_"
    return name


def _python_contract(data: dict[str, Any]) -> list[tuple[str, str]]:
    service = data["service"]
    svc = _pascal(service)
    macro = _macro(service)
    service_filename = service.replace("-", "_")
    schemas = data.get("schemas", {})
    methods = data["methods"]
    messages = data.get("messages", {})

    header = [
        "# SPDX-License-Identifier: AGPL-3.0-only",
        "",
        "# Code generated by `uv run helix protocol generate --target python`. DO NOT EDIT.",
        "from __future__ import annotations",
        "",
        "from dataclasses import dataclass, field",
        "from typing import Any, List, Mapping, Optional, Protocol",
        "",
        "from helix_service_runtime.dispatch import respond, respond_error",
        "",
        "from ._runtime import convert_value, to_wire_value",
        "",
        f"{macro}_SERVICE = {json.dumps(service)}",
    ]
    for key, definition in methods.items():
        response_name = definition.get("outputName") or definition["name"]
        header.append(f"{macro}_{_macro(key)}_METHOD = {json.dumps(definition['name'])}")
        header.append(f"{macro}_{_macro(key)}_RESPONSE_METHOD = {json.dumps(response_name)}")
    for key, definition in messages.items():
        header.append(f"{macro}_{_macro(key)}_MESSAGE = {json.dumps(definition['name'])}")

    # One top-level construct per block, joined by two blank lines so output is black-compatible.
    blocks: list[str] = ["\n".join(header)]

    for schema_name, fields in schemas.items():
        cls = _pascal(service) + _pascal(schema_name)
        required_fields: list[tuple[str, Any]] = []
        optional_fields: list[tuple[str, Any]] = []
        for field_name, definition in fields.items():
            _, required = _embedded_c_field_spec(schema_name, field_name, definition)
            (required_fields if required else optional_fields).append((field_name, definition))
        block = ["@dataclass(frozen=True)", f"class {cls}:"]
        if not required_fields and not optional_fields:
            block.append("    pass")
        for field_name, definition in required_fields:
            field_type, _ = _embedded_c_field_spec(schema_name, field_name, definition)
            py_type = _python_type_expr(service, field_type, definition)
            block.append(
                f"    {_python_attr(field_name)}: {py_type} = "
                f'field(metadata={{"wire_name": {json.dumps(field_name)}}})'
            )
        for field_name, definition in optional_fields:
            field_type, _ = _embedded_c_field_spec(schema_name, field_name, definition)
            py_type = _python_type_expr(service, field_type, definition)
            block.append(
                f"    {_python_attr(field_name)}: Optional[{py_type}] = "
                f'field(default=None, metadata={{"wire_name": {json.dumps(field_name)}}})'
            )
        blocks.append("\n".join(block))

    for schema_name in schemas:
        cls = _pascal(service) + _pascal(schema_name)
        blocks.append(
            "\n".join(
                [
                    f"def parse_{_snake(schema_name)}"
                    f"(payload: Optional[Mapping[str, Any]]) -> {cls}:",
                    f"    return convert_value(payload or {{}}, {cls})",
                ]
            )
        )

    handler = [f"class {svc}Handler(Protocol):"]
    for key, definition in methods.items():
        input_schema, output_schema = _method_io_schemas(key, definition)
        in_cls = _pascal(service) + _pascal(input_schema)
        out_cls = _pascal(service) + _pascal(output_schema)
        handler.append(f"    def handle_{_snake(key)}(self, request: {in_cls}) -> {out_cls}: ...")
    blocks.append("\n".join(handler))

    dispatch = [
        f"def dispatch_{service_filename}(",
        f"    ipc: Any, log: Any, command: Mapping[str, Any], handler: {svc}Handler",
        ") -> None:",
        '    method = str(command.get("method", ""))',
        '    request_id = str(command.get("requestId", ""))',
        '    payload = command.get("payload") or {}',
    ]
    for index, (key, definition) in enumerate(methods.items()):
        input_schema, _ = _method_io_schemas(key, definition)
        keyword_kw = "if" if index == 0 else "elif"
        dispatch.extend(
            [
                f"    {keyword_kw} method == {macro}_{_macro(key)}_METHOD:",
                "        try:",
                f"            result = handler.handle_{_snake(key)}("
                f"parse_{_snake(input_schema)}(payload))",
                "        except Exception as exc:  # noqa: BLE001",
                f"            respond_error(ipc, log, request_id, {macro}_SERVICE, str(exc))",
                "            return",
                f"        respond(ipc, log, request_id, "
                f"{macro}_{_macro(key)}_RESPONSE_METHOD, to_wire_value(result))",
                "        return",
            ]
        )
    dispatch.append(
        f'    respond_error(ipc, log, request_id, {macro}_SERVICE, f"unknown command: {{method}}")'
    )
    blocks.append("\n".join(dispatch))

    return [
        (f"{service_filename}.py", "\n\n\n".join(blocks) + "\n"),
        ("_runtime.py", _PYTHON_RUNTIME_SOURCE),
        ("__init__.py", _PYTHON_GENERATED_INIT),
    ]


_PYTHON_GENERATED_INIT = (
    "# SPDX-License-Identifier: AGPL-3.0-only\n"
    "# Code generated by `uv run helix protocol generate --target python`. DO NOT EDIT.\n"
)


_PYTHON_RUNTIME_SOURCE = """\
# SPDX-License-Identifier: AGPL-3.0-only
# Code generated by `uv run helix protocol generate --target python`. DO NOT EDIT.
from __future__ import annotations

import types
from dataclasses import fields, is_dataclass
from functools import lru_cache
from typing import Any, Mapping, Union, get_args, get_origin, get_type_hints

_UNION_TYPE = getattr(types, "UnionType", None)


@lru_cache(maxsize=None)
def _field_types(cls: Any) -> dict[str, Any]:
    return get_type_hints(cls)


def _wire_name(field: Any) -> str:
    return str(field.metadata.get("wire_name", field.name))


def _convert_primitive(value: Any, annotation: Any) -> Any:
    if value is None:
        return None
    if annotation is bool:
        return bool(value)
    if annotation is int:
        return int(value)
    if annotation is float:
        return float(value)
    if annotation is str:
        return str(value)
    return value


def convert_value(value: Any, annotation: Any) -> Any:
    if annotation is Any:
        return value
    origin = get_origin(annotation)
    if origin in (list,):
        (item_type,) = get_args(annotation) or (Any,)
        return [convert_value(item, item_type) for item in (value or [])]
    if origin in (dict,):
        _key_type, value_type = get_args(annotation) or (str, Any)
        return {
            str(key): convert_value(item, value_type)
            for key, item in dict(value or {}).items()
        }
    if origin is Union or (_UNION_TYPE is not None and origin is _UNION_TYPE):
        args = [item for item in get_args(annotation) if item is not type(None)]
        if value is None:
            return None
        if len(args) == 1:
            return convert_value(value, args[0])
    if is_dataclass(annotation):
        raw = value or {}
        if not isinstance(raw, Mapping):
            raise TypeError(
                f"expected mapping for {annotation.__name__}, got {type(raw).__name__}"
            )
        type_hints = _field_types(annotation)
        kwargs: dict[str, Any] = {}
        for field in fields(annotation):
            wire_name = _wire_name(field)
            if wire_name in raw:
                kwargs[field.name] = convert_value(
                    raw[wire_name], type_hints.get(field.name, field.type)
                )
        return annotation(**kwargs)
    return _convert_primitive(value, annotation)


def to_wire_value(value: Any) -> Any:
    if is_dataclass(value):
        payload: dict[str, Any] = {}
        for field in fields(value):
            child = getattr(value, field.name)
            if child is None:
                continue
            payload[_wire_name(field)] = to_wire_value(child)
        return payload
    if isinstance(value, list):
        return [to_wire_value(item) for item in value]
    if isinstance(value, dict):
        return {str(key): to_wire_value(item) for key, item in value.items() if item is not None}
    return value
"""


def _cpp_contract(data: dict[str, Any]) -> str:
    return "\n".join(
        [
            "#pragma once",
            "",
            "#include <string_view>",
            "",
            f'inline constexpr std::string_view HELIX_SERVICE = "{data["service"]}";',
            "",
        ]
    )


def _embedded_c_type(field_type: str) -> str:
    if field_type == "string":
        return "char *"
    if field_type == "number":
        return "int"
    if field_type == "boolean":
        return "bool"
    if field_type in ("json", "array"):
        return "const cJSON *"
    raise click.ClickException(f"Unsupported embedded-c field type: {field_type}")


def _embedded_c_field_spec(
    schema_name: str,
    field_name: str,
    definition: Any,
) -> tuple[str, bool]:
    if isinstance(definition, str):
        return definition, False
    if not isinstance(definition, dict):
        raise click.ClickException(
            f"Field {schema_name}.{field_name} must be a string type or field definition."
        )
    field_type = definition.get("type")
    required = definition.get("required", False)
    if not isinstance(field_type, str):
        raise click.ClickException(f"Field {schema_name}.{field_name} must define a string type.")
    if not isinstance(required, bool):
        raise click.ClickException(f"Field {schema_name}.{field_name}.required must be boolean.")
    return field_type, required


def _embedded_c_json_type(field_type: str) -> str:
    if field_type == "string":
        return "HELIX_JSON_FIELD_STRING"
    if field_type == "number":
        return "HELIX_JSON_FIELD_INT"
    if field_type == "boolean":
        return "HELIX_JSON_FIELD_BOOL"
    if field_type in ("json", "array"):
        return "HELIX_JSON_FIELD_VALUE"
    raise click.ClickException(f"Unsupported embedded-c field type: {field_type}")


def _embedded_c_contract(data: dict[str, Any]) -> list[tuple[str, str]]:
    service = data["service"]
    service_snake = _snake(service)
    service_macro = _macro(service)
    header_name = f"{service_snake}_contract.h"
    source_name = f"{service_snake}_contract.c"
    guard = f"GENERATED_CONTRACTS_{service_macro}_H"
    schemas = data.get("schemas", {})
    if not isinstance(schemas, dict):
        raise click.ClickException(
            "embedded-c contracts require schemas to be an object when provided."
        )

    header = [
        "/* Code generated by `uv run helix protocol generate --target embedded-c`. "
        "DO NOT EDIT. */",
        f"#ifndef {guard}",
        f"#define {guard}",
        "",
        "#include <stdbool.h>",
        "",
        '#include "cJSON.h"',
        '#include "esp_err.h"',
        "",
        f'#define {service_macro}_SERVICE "{service}"',
    ]
    for key, definition in data["methods"].items():
        header.append(f'#define {service_macro}_{_macro(key)}_METHOD "{definition["name"]}"')
    for key, definition in data.get("messages", {}).items():
        header.append(f'#define {service_macro}_{_macro(key)}_MESSAGE "{definition["name"]}"')
    header.append("")

    source = [
        "/* Code generated by `uv run helix protocol generate --target embedded-c`. "
        "DO NOT EDIT. */",
        f'#include "{header_name}"',
        "",
        '#include "helix_json.h"',
        "",
    ]

    for schema_name, fields in schemas.items():
        if not isinstance(fields, dict):
            raise click.ClickException(f"Schema {schema_name} must be an object.")
        struct_name = f"{service_snake}_{_snake(schema_name)}_t"
        header.append(f"typedef struct {struct_name} {{")
        for field_name, definition in fields.items():
            field_type, _ = _embedded_c_field_spec(schema_name, field_name, definition)
            c_type = _embedded_c_type(field_type)
            header.append(f"    {c_type} {_snake(field_name)};")
        header.append(f"}} {struct_name};")
        header.append("")

    for schema_name, fields in schemas.items():
        struct_name = f"{service_snake}_{_snake(schema_name)}_t"
        fn_name = f"{service_snake}_parse_{_snake(schema_name)}"
        descriptor_name = f"s_{_snake(schema_name)}_fields"
        header.append(f"esp_err_t {fn_name}(const cJSON *payload, {struct_name} *out);")
        source.append(f"static const helix_json_field_t {descriptor_name}[] = {{")
        for field_name, definition in fields.items():
            field_type, required = _embedded_c_field_spec(schema_name, field_name, definition)
            source.append(
                "    HELIX_JSON_FIELD("
                f'{struct_name}, {_snake(field_name)}, "{field_name}", '
                f"{_embedded_c_json_type(field_type)}, {str(required).lower()}),"
            )
        source.extend(
            [
                "};",
                "",
                f"esp_err_t {fn_name}(const cJSON *payload, {struct_name} *out)",
                "{",
                "    return helix_json_decode_object(",
                "        payload,",
                "        out,",
                "        sizeof(*out),",
                f"        {descriptor_name},",
                f"        HELIX_ARRAY_SIZE({descriptor_name})",
                "    );",
                "}",
                "",
            ]
        )
    header.extend(["", f"#endif /* {guard} */", ""])
    return [(header_name, "\n".join(header)), (source_name, "\n".join(source))]


def _render_contract(data: dict[str, Any], target: str) -> list[tuple[str, str]]:
    service_filename = data["service"].replace("-", "_")
    if target == "typescript":
        return [(f"{service_filename}.ts", _typescript_contract(data))]
    if target == "python":
        return _python_contract(data)
    if target == "go":
        return [(f"{service_filename}.go", _go_contract(data))]
    if target == "cpp":
        return [(f"{service_filename}.hpp", _cpp_contract(data))]
    if target == "embedded-c":
        return _embedded_c_contract(data)
    raise click.ClickException(f"Unsupported target: {target}")


def _write_contract_outputs(source: Path, target: str, out_dir: Path) -> None:
    data = _load_contract(source)
    outputs = _render_contract(data, target)
    out_dir.mkdir(parents=True, exist_ok=True)
    for filename, content in outputs:
        output_path = out_dir / filename
        output_path.write_text(content, encoding="utf-8")
        click.echo(f"Generated {target} contract: {output_path}")


def _resolve_manifest_path(base_dir: Path, value: Any, field: str) -> Path:
    if not isinstance(value, str) or value.strip() == "":
        raise click.ClickException(
            f"Contract generation manifest field {field} must be a path string."
        )
    path = Path(value)
    return path if path.is_absolute() else base_dir / path


def _load_generation_manifest(manifest: Path) -> dict[str, Any]:
    try:
        payload = json.loads(manifest.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise click.ClickException(f"Invalid contract generation manifest: {exc}") from exc
    if not isinstance(payload, dict):
        raise click.ClickException("Contract generation manifest must be a JSON object.")
    contracts = payload.get("contracts")
    if not isinstance(contracts, list):
        raise click.ClickException("Contract generation manifest must define contracts[].")
    return payload


@click.group()
def protocol() -> None:
    """Helix protocol tooling."""


@protocol.command()
@click.option(
    "--source", type=click.Path(exists=True, dir_okay=False, path_type=Path), required=True
)
def validate(source: Path) -> None:
    """Validate a Helix service contract source file."""

    _load_contract(source)
    click.echo(f"Valid Helix contract: {source}")


@protocol.command()
@click.option(
    "--source", type=click.Path(exists=True, dir_okay=False, path_type=Path), required=True
)
@click.option("--target", type=click.Choice(SUPPORTED_TARGETS), required=True)
@click.option("--out", "out_dir", type=click.Path(file_okay=False, path_type=Path), required=True)
def generate(source: Path, target: str, out_dir: Path) -> None:
    """Generate language bindings for a Helix service contract."""

    _write_contract_outputs(source, target, out_dir)


@protocol.command("generate-all")
@click.option(
    "--manifest",
    type=click.Path(exists=True, dir_okay=False, path_type=Path),
    default=Path("helix.contracts.json"),
    show_default=True,
)
def generate_all(manifest: Path) -> None:
    """Generate all contract outputs declared in a Helix contract generation manifest."""

    payload = _load_generation_manifest(manifest)
    base_dir = manifest.resolve().parent
    for index, contract in enumerate(payload["contracts"]):
        if not isinstance(contract, dict):
            raise click.ClickException(f"contracts[{index}] must be an object.")
        source = _resolve_manifest_path(
            base_dir, contract.get("source"), f"contracts[{index}].source"
        )
        outputs = contract.get("outputs")
        if not isinstance(outputs, list) or not outputs:
            raise click.ClickException(f"contracts[{index}].outputs must be a non-empty list.")
        for output_index, output in enumerate(outputs):
            if not isinstance(output, dict):
                raise click.ClickException(
                    f"contracts[{index}].outputs[{output_index}] must be an object."
                )
            target = output.get("target")
            if target not in SUPPORTED_TARGETS:
                raise click.ClickException(
                    f"contracts[{index}].outputs[{output_index}].target must be one of "
                    f"{', '.join(SUPPORTED_TARGETS)}."
                )
            out_dir = _resolve_manifest_path(
                base_dir,
                output.get("out"),
                f"contracts[{index}].outputs[{output_index}].out",
            )
            _write_contract_outputs(source, target, out_dir)
