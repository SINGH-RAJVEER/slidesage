import { expect, it, mock } from "bun:test";
import { act, renderHook } from "@testing-library/react";

let userId = "user_a";
mock.module("@slidesage/ui/context/AuthContext", () => ({
	useAuth: () => ({ user: { id: userId } }),
}));

const { pageDraftKey, usePageDraft } = await import("../../hooks/usePageDraft");
const valid = (value: unknown): value is string => typeof value === "string";

it("restores each account's own draft after changing accounts", () => {
	userId = "user_a";
	const hook = renderHook(() => usePageDraft("test", "", valid));
	act(() => hook.result.current[1]("Account A draft"));
	userId = "user_b";
	hook.rerender();
	expect(hook.result.current[0]).toBe("");
	act(() => hook.result.current[1]("Account B draft"));
	userId = "user_a";
	hook.rerender();
	expect(hook.result.current[0]).toBe("Account A draft");
});

it("a new retry replaces the old setup while returning to the same retry restores edits", () => {
	const first = renderHook(() => usePageDraft("test", "Retry one", valid, "retry_1"));
	act(() => first.result.current[1]("Edited retry one"));
	first.unmount();
	const restored = renderHook(() => usePageDraft("test", "Retry one", valid, "retry_1"));
	expect(restored.result.current[0]).toBe("Edited retry one");
	restored.unmount();
	const next = renderHook(() => usePageDraft("test", "Retry two", valid, "retry_2"));
	expect(next.result.current[0]).toBe("Retry two");
});

it("late responses from a previous page cannot overwrite a newer setup", () => {
	const first = renderHook(() => usePageDraft("test", "", valid, "old_visit"));
	const oldSetter = first.result.current[1];
	first.unmount();
	const next = renderHook(() => usePageDraft("test", "", valid, "new_visit"));
	act(() => next.result.current[1]("My new setup"));
	act(() => oldSetter("Late result"));
	next.unmount();
	const restored = renderHook(() => usePageDraft("test", "", valid, "new_visit"));
	expect(restored.result.current[0]).toBe("My new setup");
});

it("ignores malformed stored data", () => {
	localStorage.setItem(pageDraftKey(userId, "test"), '{"value":42}');
	const first = renderHook(() => usePageDraft("test", "Default", valid));
	expect(first.result.current[0]).toBe("Default");
	first.unmount();
	localStorage.setItem(pageDraftKey(userId, "test"), "invalid JSON");
	const second = renderHook(() => usePageDraft("test", "Default", valid));
	expect(second.result.current[0]).toBe("Default");
});
