import { initGetDefaultFieldName } from "./get-default-field-name.mjs";
import { initGetDefaultModelName } from "./get-default-model-name.mjs";
import { initGetFieldAttributes } from "./get-field-attributes.mjs";
import { initGetFieldName } from "./get-field-name.mjs";
import { initGetIdField } from "./get-id-field.mjs";
import { initGetModelName } from "./get-model-name.mjs";
import { AdapterConfig, AdapterFactoryConfig, AdapterFactoryCustomizeAdapterCreator, AdapterFactoryOptions, AdapterTestDebugLogs, CleanedWhere, CreateAdapterOptions, CreateCustomAdapter, CustomAdapter } from "./types.mjs";
import { DBAdapter } from "./index.mjs";
import { BetterAuthOptions } from "../../types/init-options.mjs";
import "../../types/index.mjs";

//#region src/db/adapter/factory.d.ts
type AdapterFactory = (options: BetterAuthOptions) => DBAdapter<BetterAuthOptions>;
declare const createAdapterFactory: ({
  adapter: customAdapter,
  config: cfg
}: AdapterFactoryOptions) => AdapterFactory;
/**
 * @deprecated Use `createAdapterFactory` instead. This export will be removed in a future version.
 * @alias
 */
declare const createAdapter: ({
  adapter: customAdapter,
  config: cfg
}: AdapterFactoryOptions) => AdapterFactory;
//#endregion
export { AdapterFactory, createAdapter, createAdapterFactory };
//# sourceMappingURL=factory.d.mts.map