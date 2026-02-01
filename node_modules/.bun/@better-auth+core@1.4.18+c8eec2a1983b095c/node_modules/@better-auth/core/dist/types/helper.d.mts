//#region src/types/helper.d.ts
type Primitive = string | number | symbol | bigint | boolean | null | undefined;
type Awaitable<T> = T | Promise<T>;
type LiteralString = "" | (string & Record<never, never>);
type LiteralUnion<LiteralType, BaseType extends Primitive> = LiteralType | (BaseType & Record<never, never>);
type Prettify<T> = { [K in keyof T]: T[K] } & {};
//#endregion
export { Awaitable, LiteralString, LiteralUnion, Prettify, Primitive };
//# sourceMappingURL=helper.d.mts.map