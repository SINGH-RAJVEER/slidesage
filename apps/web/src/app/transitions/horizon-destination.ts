export function horizonDestination(
	signedIn: boolean,
	defaultPage: string | undefined,
	returning: boolean,
) {
	if (signedIn) return defaultPage === "presentations" ? "/presentations" : "/generate";
	return returning ? "/sign-in" : "/sign-up";
}
