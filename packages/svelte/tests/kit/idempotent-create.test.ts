import * as Option from "effect/Option";
import { describe, expect, it, vi } from "vite-plus/test";
import { idempotentCreate } from "../../src/kit/index.ts";
import { conflict409, ErrorResponse, JsonapiError, testFailure } from "./fixtures.ts";

type Input = { readonly id?: string; readonly name: string };

describe("idempotentCreate", () => {
  it("passes a successful create straight through", async () => {
    const fetchExisting = vi.fn(async (id: string) => id);
    const create = idempotentCreate(async (input: Input) => `created-${input.name}`, fetchExisting);
    await expect(create({ id: "a", name: "x" })).resolves.toBe("created-x");
    expect(fetchExisting).not.toHaveBeenCalled();
  });

  it("re-fetches the submitted id on a 409 and returns it", async () => {
    const fetchExisting = vi.fn(async (id: string) => `existing-${id}`);
    const create = idempotentCreate<Input, string>(async () => {
      throw conflict409();
    }, fetchExisting);
    await expect(create({ id: "a", name: "x" })).resolves.toBe("existing-a");
    expect(fetchExisting).toHaveBeenCalledWith("a");
  });

  it("recognises effect-jsonapi's client-side ErrorResponse at 409 too", async () => {
    const create = idempotentCreate<Input, string>(
      async () => {
        throw new ErrorResponse({ status: 409, message: "Conflict", document: Option.none() });
      },
      async (id) => id,
    );
    await expect(create({ id: "a", name: "x" })).resolves.toBe("a");
  });

  it("rethrows the ORIGINAL conflict when the re-fetch fails", async () => {
    const conflict = conflict409("Position collision.");
    const create = idempotentCreate<Input, string>(
      async () => {
        throw conflict;
      },
      async () => {
        throw testFailure("not found");
      },
    );
    await expect(create({ id: "a", name: "x" })).rejects.toBe(conflict);
  });

  it("rethrows a 409 when the input carries no id", async () => {
    const conflict = conflict409();
    const fetchExisting = vi.fn(async (id: string) => id);
    const create = idempotentCreate<Input, string>(async () => {
      throw conflict;
    }, fetchExisting);
    await expect(create({ name: "x" })).rejects.toBe(conflict);
    await expect(create({ id: "", name: "x" })).rejects.toBe(conflict);
    expect(fetchExisting).not.toHaveBeenCalled();
  });

  it("rethrows any non-409 failure unchanged", async () => {
    const unprocessable = new JsonapiError({ status: 422, errors: [] });
    const fetchExisting = vi.fn(async (id: string) => id);
    const create = idempotentCreate<Input, string>(async () => {
      throw unprocessable;
    }, fetchExisting);
    await expect(create({ id: "a", name: "x" })).rejects.toBe(unprocessable);
    expect(fetchExisting).not.toHaveBeenCalled();
  });
});
