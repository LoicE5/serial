export type BuildOutput = {
  publicDirectory: string;
  serverDirectory?: string;
};

export function getBuildOutput(
  environment: NodeJS.ProcessEnv = process.env,
): BuildOutput {
  const preset = environment.NITRO_PRESET?.trim().toLowerCase();
  const isVercel = preset ? preset === "vercel" : Boolean(environment.VERCEL);

  if (isVercel) {
    return {
      publicDirectory: ".vercel/output/static",
    };
  }

  return {
    publicDirectory: ".output/public",
    serverDirectory: ".output/server",
  };
}
