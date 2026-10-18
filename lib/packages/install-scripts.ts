const INSTALL_SCRIPT_NAMES = ["preinstall", "install", "postinstall"] as const;
const COMMAND_MAX = 500;

export type InstallScriptName = (typeof INSTALL_SCRIPT_NAMES)[number];

export type InstallScript = {
  name: InstallScriptName;
  command: string;
};

/** Lifecycle scripts that run on the machine during install. Other scripts are ignored. */
export function listInstallScripts(scripts: unknown): InstallScript[] {
  if (!scripts || typeof scripts !== "object") return [];
  const record = scripts as Record<string, unknown>;
  return INSTALL_SCRIPT_NAMES.flatMap((name) => {
    const raw = record[name];
    if (typeof raw !== "string" || !raw.trim()) return [];
    const command = raw.trim().replace(/\s*\n\s*/g, "\n");
    return [
      {
        name,
        command:
          command.length > COMMAND_MAX
            ? `${command.slice(0, COMMAND_MAX - 1)}…`
            : command,
      },
    ];
  });
}
