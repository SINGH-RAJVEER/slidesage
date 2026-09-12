const SIGNED_IN_BEFORE = "slidesage-signed-in-before";

/** A browser-local hint only; never an authentication or account lookup. */
export function rememberSignedIn() {
	try {
		localStorage.setItem(SIGNED_IN_BEFORE, "1");
	} catch {
		/* Storage can be disabled. */
	}
}

export function hasSignedInBefore() {
	try {
		return localStorage.getItem(SIGNED_IN_BEFORE) === "1";
	} catch {
		return false;
	}
}
