import { should } from "chai";
import { vi } from "vitest";

// Next.js server-only guard; allow unit tests to import DB modules.
vi.mock("server-only", () => ({}));

should();
