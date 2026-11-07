import { StrokeIcon } from "@/components/icons/StrokeIcon";
import type { IconProps } from "@/components/icons/icon-props";

/** Minus in a circle — clearer than a bare dash at small sizes. */
export const MinusIcon = ({ className = "w-4 h-4" }: IconProps) => (
  <StrokeIcon className={className}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M15 12H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </StrokeIcon>
);
