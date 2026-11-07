import { StrokeIcon } from "@/components/icons/StrokeIcon";
import type { IconProps } from "@/components/icons/icon-props";

/** Swap / replace arrows — reads as “changed” at table size. */
export const ArrowPathIcon = ({ className = "w-4 h-4" }: IconProps) => (
  <StrokeIcon className={className}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"
    />
  </StrokeIcon>
);
