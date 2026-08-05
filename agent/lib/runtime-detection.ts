export interface RuntimeDetectionOptions {
  readonly argv?: readonly string[];
  readonly environment?: NodeJS.ProcessEnv;
}

export interface RuntimeDetection {
  readonly isBuildProcess: boolean;
  readonly isDeployedRuntime: boolean;
  readonly isDeployedVercel: boolean;
  readonly isDeploymentLike: boolean;
  readonly isProductionRuntime: boolean;
}

export function detectRuntime(options: RuntimeDetectionOptions = {}): RuntimeDetection {
  const environment = options.environment ?? process.env;
  const argv = options.argv ?? process.argv;
  const vercelEnvironment = environment.VERCEL_ENV;
  const onVercel = environment.VERCEL === "1" || Boolean(vercelEnvironment);
  const isBuildProcess = argv.some((argument) => argument === "build");
  const isDeployedVercel = onVercel && vercelEnvironment !== "development";
  const isProductionRuntime =
    environment.NODE_ENV === "production" && environment.EVE_DEV !== "1" && !isBuildProcess;

  return {
    isBuildProcess,
    isDeployedRuntime: isDeployedVercel && !isBuildProcess,
    isDeployedVercel,
    isDeploymentLike: isDeployedVercel || isProductionRuntime,
    isProductionRuntime,
  };
}
