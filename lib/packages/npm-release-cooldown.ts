const MS_PER_HOUR = 1000 * 60 * 60;

export type NpmReleaseCooldownStatus = {
  withinCooldown: boolean;
  /** Whole hours since publish, floored. Null when the publish time is missing. */
  hoursSincePublish: number | null;
};

/**
 * True when the latest publish is younger than `cooldownHours`.
 * `cooldownHours` of 0 disables the check.
 */
export function npmReleaseCooldownStatus(options: {
  publishedAt: string | null | undefined;
  cooldownHours: number;
  now?: number | Date;
}): NpmReleaseCooldownStatus {
  const cooldownHours = Math.max(0, Math.floor(Number(options.cooldownHours)));
  if (!options.publishedAt || !Number.isFinite(cooldownHours)) {
    return { withinCooldown: false, hoursSincePublish: null };
  }

  const published = new Date(options.publishedAt).getTime();
  if (Number.isNaN(published)) {
    return { withinCooldown: false, hoursSincePublish: null };
  }

  const now =
    options.now instanceof Date
      ? options.now.getTime()
      : typeof options.now === "number"
        ? options.now
        : Date.now();

  const hoursSincePublish = Math.max(
    0,
    Math.floor((now - published) / MS_PER_HOUR),
  );

  if (cooldownHours <= 0) {
    return { withinCooldown: false, hoursSincePublish };
  }

  return {
    withinCooldown: hoursSincePublish < cooldownHours,
    hoursSincePublish,
  };
}

export function isWithinNpmReleaseCooldown(options: {
  publishedAt: string | null | undefined;
  cooldownHours: number;
  now?: number | Date;
}): boolean {
  return npmReleaseCooldownStatus(options).withinCooldown;
}

export function formatHoursSincePublish(hours: number): string {
  const value = Math.max(0, Math.floor(Number(hours)));
  if (!Number.isFinite(value)) return "Unknown";
  if (value === 0) return "less than 1 hour ago";
  if (value === 1) return "1 hour ago";
  if (value < 48) return `${value} hours ago`;
  const days = Math.floor(value / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

export function npmReleaseCooldownCaution(options: {
  hoursSincePublish: number;
  cooldownHours: number;
}): string {
  const age = formatHoursSincePublish(options.hoursSincePublish);
  const window =
    options.cooldownHours === 168
      ? "7-day"
      : `${options.cooldownHours}-hour`;
  return `Published ${age} · under your ${window} cooldown`;
}
