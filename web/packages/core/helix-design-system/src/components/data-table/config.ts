/**
 * Compile-time view of the supported data-table operators, variants, and sort
 * directions. Consumers can reference this type to stay aligned with the
 * published config object.
 */
export type DataTableConfig = typeof dataTableConfig;

const OPERATORS = {
  IS_NOT_EMPTY: { label: 'Is not empty', value: 'isNotEmpty' as const },
  IS_EMPTY: { label: 'Is empty', value: 'isEmpty' as const },
  IS: { label: 'Is', value: 'eq' as const },
  IS_NOT: { label: 'Is not', value: 'ne' as const },
};

/**
 * Canonical operator and filter metadata shared by the design-system data table
 * components and parser helpers. Values here intentionally match the query
 * parser enums in `parsers.ts`.
 */
export const dataTableConfig = {
  textOperators: [
    { label: 'Contains', value: 'iLike' as const },
    { label: 'Does not contain', value: 'notILike' as const },
    OPERATORS.IS,
    OPERATORS.IS_NOT,
    OPERATORS.IS_EMPTY,
    OPERATORS.IS_NOT_EMPTY,
  ],
  numericOperators: [
    OPERATORS.IS,
    OPERATORS.IS_NOT,
    OPERATORS.IS_EMPTY,
    OPERATORS.IS_NOT_EMPTY,
    { label: 'Is less than', value: 'lt' as const },
    { label: 'Is less than or equal to', value: 'lte' as const },
    { label: 'Is greater than', value: 'gt' as const },
    { label: 'Is greater than or equal to', value: 'gte' as const },
    { label: 'Is between', value: 'isBetween' as const },
  ],
  dateOperators: [
    { label: 'Is before', value: 'lt' as const },
    { label: 'Is after', value: 'gt' as const },
    { label: 'Is on or before', value: 'lte' as const },
    { label: 'Is on or after', value: 'gte' as const },
    { label: 'Is between', value: 'isBetween' as const },
    { label: 'Is relative to today', value: 'isRelativeToToday' as const },
    OPERATORS.IS,
    OPERATORS.IS_NOT,
    OPERATORS.IS_EMPTY,
    OPERATORS.IS_NOT_EMPTY,
  ],
  selectOperators: [OPERATORS.IS, OPERATORS.IS_NOT, OPERATORS.IS_EMPTY, OPERATORS.IS_NOT_EMPTY],
  multiSelectOperators: [
    { label: 'Has any of', value: 'inArray' as const },
    { label: 'Has none of', value: 'notInArray' as const },
    OPERATORS.IS_EMPTY,
    OPERATORS.IS_NOT_EMPTY,
  ],
  booleanOperators: [OPERATORS.IS, OPERATORS.IS_NOT],
  sortOrders: [
    { label: 'Asc', value: 'asc' as const },
    { label: 'Desc', value: 'desc' as const },
  ],
  filterVariants: [
    'text',
    'number',
    'range',
    'date',
    'dateRange',
    'boolean',
    'select',
    'multiSelect',
  ] as const,
  operators: [
    'iLike',
    'notILike',
    'eq',
    'ne',
    'inArray',
    'notInArray',
    'isEmpty',
    'isNotEmpty',
    'lt',
    'lte',
    'gt',
    'gte',
    'isBetween',
    'isRelativeToToday',
  ] as const,
  joinOperators: ['and', 'or'] as const,
};
