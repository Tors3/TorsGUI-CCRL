/** A text: plain, or one form per plural category ("one", "other", "few"…) of `count`. */
export type Text = string | ({ other: string } & Partial<Record<Intl.LDMLPluralRule, string>>);

/** A text, not a group of texts: a string, or an object whose keys are all plural categories. */
export type IsText<V> = V extends string ? true : V extends object ? (Exclude<keyof V, Intl.LDMLPluralRule> extends never ? ("other" extends keyof V ? true : false) : false) : false;

/** The same shape as an English area, every text replaceable (the plural forms too). */
export type Shape<T> = { [K in keyof T]: IsText<T[K]> extends true ? Text : Shape<T[K]> };
