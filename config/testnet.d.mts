export interface TestnetConfig {
  networkPassphrase: string;
  rpcUrl: string;
  viewerPublicKey: string;
  validatorContractId: string;
  verifierContractId: string;
}

export declare const TESTNET_DEFAULTS: Readonly<TestnetConfig>;
export declare function resolveTestnetConfig(
  env?: Record<string, unknown>,
): TestnetConfig;
export declare const testnetConfig: TestnetConfig;
