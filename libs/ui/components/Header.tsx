import {
	Bug,
	ChevronRight,
	Coins,
	LayoutGrid,
	LogOut,
	MessageSquare,
	Settings,
	Sparkles,
	Store,
	UserRound,
} from "lucide-react";
import { type ComponentType, type ReactNode, useState } from "react";
import { useIsMobile } from "../hooks/useIsMobile";
import { usePrefetchIntent } from "../hooks/usePrefetchIntent";
import { cn } from "../lib/utils";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "./dropdown-menu";
import { SlideSageLogo } from "./SlideSageLogo";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./sheet";

export interface HeaderUser {
	name?: string | null;
	email: string;
	image?: string | null;
	slideTokens?: number | null;
}

export interface HeaderRoutes {
	home: string;
	landing: string;
	generate: string;
	research: string;
	presentations: string;
	marketplace: string;
	purchase: string;
	profile: string;
	settings: string;
	feedback: string;
	auth: string[];
}

const BUG_REPORT_URL = "https://github.com/SINGH-RAJVEER/slidesage/issues";

export interface HeaderLinkProps {
	to: string;
	className?: string;
	"aria-label"?: string;
	"aria-current"?: "page";
	onClick?: () => void;
	children: ReactNode;
}

function accountLinks(routes: HeaderRoutes) {
	return [
		{ path: routes.profile, label: "Profile", Icon: UserRound },
		{ path: routes.settings, label: "Settings", Icon: Settings },
		{ path: routes.feedback, label: "Feedback", Icon: MessageSquare },
	];
}

interface HeaderProps {
	currentPath: string;
	routes: HeaderRoutes;
	LinkComponent: ComponentType<HeaderLinkProps>;
	user?: HeaderUser | null;
	sticky?: boolean;
	onNavigate: (path: string) => void;
	/** Called once the user looks about to open a page the header reaches without a link. */
	onPrefetch?: (path: string) => void;
	onSignOut: () => Promise<void>;
}

export function Header({
	currentPath,
	routes,
	LinkComponent,
	user,
	sticky = false,
	onNavigate,
	onPrefetch,
	onSignOut,
}: HeaderProps) {
	const isMobile = useIsMobile();
	const [signingOut, setSigningOut] = useState(false);
	const purchaseIntent = usePrefetchIntent(
		onPrefetch ? () => onPrefetch(routes.purchase) : undefined,
	);

	const handleSignOut = async () => {
		if (signingOut) return;
		setSigningOut(true);
		try {
			await onSignOut();
		} catch {
			setSigningOut(false);
		}
	};

	const getUserInitials = () => {
		const trimmedName = user?.name?.trim();
		if (trimmedName) {
			const nameParts = trimmedName.split(/\s+/);
			const firstInitial = nameParts[0]?.charAt(0) ?? "";
			const lastInitial =
				nameParts.length > 1 ? (nameParts[nameParts.length - 1]?.charAt(0) ?? "") : "";
			return `${firstInitial}${lastInitial}`.toUpperCase() || "U";
		}
		return user?.email?.charAt(0)?.toUpperCase() || "U";
	};

	const isAuthPage = routes.auth.some(
		(path) => currentPath === path || currentPath.startsWith(`${path}/`),
	);
	const isActive = (path: string) => {
		if (path === routes.presentations && currentPath === routes.presentations) return true;
		if (
			path === routes.generate &&
			(currentPath === routes.generate || currentPath === routes.research)
		) {
			return true;
		}
		return currentPath.startsWith(path) && path !== routes.home;
	};

	const points = `${user?.slideTokens?.toFixed(1) ?? "0.0"} points`;
	const avatar = user && <Avatar user={user} initials={getUserInitials()} className="text-base" />;

	if (isMobile) {
		return (
			<MobileHeader
				routes={routes}
				LinkComponent={LinkComponent}
				user={user}
				sticky={sticky}
				isAuthPage={isAuthPage}
				isActive={isActive}
				points={points}
				initials={getUserInitials()}
				signingOut={signingOut}
				onNavigate={onNavigate}
				purchaseIntent={purchaseIntent}
				onSignOut={handleSignOut}
			/>
		);
	}

	return (
		<header
			data-app-header
			className={cn(
				"w-full border-b border-white/10 bg-[hsl(222,27%,12%)]/95 backdrop-blur-md",
				sticky && "sticky top-0 z-50",
			)}
		>
			<div className="grid h-16 w-full grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 md:grid-cols-3 md:px-10">
				<div className="hidden items-center md:flex md:w-full">
					<LinkComponent to={routes.landing} aria-label="SlideSage — landing">
						<SlideSageLogo className="h-9 w-auto" />
					</LinkComponent>
				</div>

				{!isAuthPage && (
					<div className="min-w-0 overflow-x-auto md:col-span-1">
						<div className="flex min-w-max items-center gap-2 md:mx-auto md:w-max">
							<nav className="flex items-center gap-1 md:gap-2">
								{[
									[routes.generate, "Generate"],
									[routes.presentations, "Presentations"],
									[routes.marketplace, "Marketplace"],
								].map(([path, label]) => (
									<LinkComponent
										key={path}
										to={path as string}
										className={cn(
											"flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors md:min-h-0 md:px-4 md:py-2.5 md:text-base",
											isActive(path as string)
												? "bg-white/10 text-white"
												: "text-white/70 hover:bg-white/5 hover:text-white",
										)}
									>
										{label}
									</LinkComponent>
								))}
							</nav>
						</div>
					</div>
				)}

				<div className="flex items-center justify-end gap-2 md:w-full md:gap-4">
					{user && (
						<>
							<button
								type="button"
								{...purchaseIntent}
								onClick={() => onNavigate(routes.purchase)}
								className="hidden rounded-full border border-white/10 px-5 py-2 text-base font-medium text-white/90 transition-colors hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/20 lg:block"
								title="Click to purchase more points"
							>
								{points}
							</button>

							<DropdownMenu>
								<DropdownMenuTrigger
									aria-label="Open account menu"
									className="rounded-full ring-offset-black transition-all focus:outline-none focus:ring-2 focus:ring-white/20"
								>
									{avatar}
								</DropdownMenuTrigger>
								<DropdownMenuContent
									align="end"
									className="w-max min-w-0 rounded-xl border border-white/10 bg-[hsl(222,27%,12%)] p-1 text-white shadow-2xl"
								>
									{accountLinks(routes).map(({ path, label, Icon }) => (
										<DropdownMenuItem
											key={path}
											asChild
											className="rounded-lg px-0 py-0 text-white/80 focus:bg-white/10 focus:text-white"
										>
											<LinkComponent
												to={path}
												className="flex items-center gap-2 px-3 py-2 text-sm whitespace-nowrap outline-none transition-colors"
											>
												<Icon aria-hidden="true" className="size-4" />
												{label}
											</LinkComponent>
										</DropdownMenuItem>
									))}
									<DropdownMenuItem
										asChild
										className="rounded-lg px-0 py-0 text-white/80 focus:bg-white/10 focus:text-white"
									>
										<a
											href={BUG_REPORT_URL}
											target="_blank"
											rel="noopener noreferrer"
											className="flex items-center gap-2 px-3 py-2 text-sm whitespace-nowrap outline-none transition-colors"
										>
											<Bug aria-hidden="true" className="size-4" />
											Report a bug
										</a>
									</DropdownMenuItem>
									<DropdownMenuItem
										disabled={signingOut}
										onSelect={() => void handleSignOut()}
										className="items-center gap-2 rounded-lg px-3 py-2 text-sm whitespace-nowrap text-red-400 outline-none transition-colors hover:text-red-300 focus:bg-red-500/10 focus:text-red-300"
									>
										<LogOut aria-hidden="true" className="size-4" />
										{signingOut ? "Signing out..." : "Sign Out"}
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</>
					)}
				</div>
			</div>
		</header>
	);
}

function Avatar({
	user,
	initials,
	className,
}: {
	user: HeaderUser;
	initials: string;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-white/20 bg-white/10 shadow-sm transition-colors hover:border-white/40",
				className,
			)}
		>
			{user.image ? (
				<img
					src={user.image}
					alt={user.name ? `${user.name}'s profile` : "User profile"}
					className="size-full object-cover"
				/>
			) : (
				<span className="flex-shrink-0 font-semibold uppercase text-white/90">{initials}</span>
			)}
		</div>
	);
}

interface MobileHeaderProps {
	routes: HeaderRoutes;
	LinkComponent: ComponentType<HeaderLinkProps>;
	user?: HeaderUser | null;
	sticky: boolean;
	isAuthPage: boolean;
	isActive: (path: string) => boolean;
	points: string;
	initials: string;
	signingOut: boolean;
	onNavigate: (path: string) => void;
	purchaseIntent: ReturnType<typeof usePrefetchIntent>;
	onSignOut: () => Promise<void>;
}

/**
 * The header on a phone: a slim bar with the logo and the points balance, and
 * the main pages as tabs along the bottom, within reach of a thumb. The account
 * menu opens as a sheet from the last tab.
 */
function MobileHeader({
	routes,
	LinkComponent,
	user,
	sticky,
	isAuthPage,
	isActive,
	points,
	initials,
	signingOut,
	onNavigate,
	purchaseIntent,
	onSignOut,
}: MobileHeaderProps) {
	const [accountOpen, setAccountOpen] = useState(false);
	const showTabs = !isAuthPage;
	const tabs = [
		{ path: routes.generate, label: "Generate", Icon: Sparkles },
		{ path: routes.presentations, label: "Presentations", Icon: LayoutGrid },
		{ path: routes.marketplace, label: "Marketplace", Icon: Store },
	];
	const tabClassName = cn(
		"flex min-w-0 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
		"short:flex-row short:gap-2 short:text-xs",
	);
	const go = (path: string) => {
		setAccountOpen(false);
		onNavigate(path);
	};

	return (
		<>
			<header
				data-app-header
				data-tab-bar={showTabs ? "" : undefined}
				className={cn(
					"w-full border-b border-white/10 bg-[hsl(222,27%,12%)]/95 pt-[env(safe-area-inset-top)] backdrop-blur-md",
					sticky && "sticky top-0 z-50",
				)}
			>
				<div
					className={cn(
						"flex h-14 items-center justify-between gap-3 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]",
						"short:h-12",
					)}
				>
					<LinkComponent to={routes.landing} aria-label="SlideSage — landing">
						<SlideSageLogo className="h-7 w-auto" />
					</LinkComponent>
					{user && (
						<button
							type="button"
							{...purchaseIntent}
							onClick={() => onNavigate(routes.purchase)}
							aria-label={`${points}. Buy more points`}
							className="flex h-10 items-center gap-1.5 rounded-full border border-white/10 px-3.5 text-sm font-medium tabular-nums text-white/90 transition-colors active:bg-white/10"
						>
							<Coins aria-hidden="true" className="size-4 text-amber-300/90" />
							{user.slideTokens?.toFixed(1) ?? "0.0"}
						</button>
					)}
				</div>
			</header>

			{showTabs && (
				<nav
					aria-label="Main"
					className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[hsl(222,27%,10%)]/95 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] backdrop-blur-md"
				>
					<div className={cn("mx-auto flex h-16 max-w-xl items-stretch", "short:h-12")}>
						{tabs.map(({ path, label, Icon }) => {
							const active = isActive(path);
							return (
								<LinkComponent
									key={path}
									to={path}
									aria-current={active ? "page" : undefined}
									className={cn(tabClassName, active ? "text-white" : "text-white/50")}
								>
									<Icon aria-hidden="true" className={cn("size-5", active && "text-sky-300")} />
									<span className="max-w-full truncate">{label}</span>
								</LinkComponent>
							);
						})}
						{user && (
							<button
								type="button"
								onClick={() => setAccountOpen(true)}
								aria-label="Open account menu"
								aria-haspopup="dialog"
								className={cn(tabClassName, accountOpen ? "text-white" : "text-white/50")}
							>
								<Avatar
									user={user}
									initials={initials}
									className="size-5 border-white/25 text-[9px]"
								/>
								<span>Account</span>
							</button>
						)}
					</div>
				</nav>
			)}

			{user && (
				<Sheet open={accountOpen} onOpenChange={setAccountOpen}>
					<SheetContent side="bottom" className="gap-5">
						<SheetHeader className="flex-row items-center gap-3">
							<Avatar user={user} initials={initials} className="size-12 shrink-0 text-lg" />
							<div className="min-w-0">
								<SheetTitle className="truncate">{user.name?.trim() || "Account"}</SheetTitle>
								<SheetDescription className="truncate">{user.email}</SheetDescription>
							</div>
						</SheetHeader>

						<button
							type="button"
							{...purchaseIntent}
							onClick={() => go(routes.purchase)}
							className="flex min-h-14 items-center gap-3 rounded-xl bg-white/5 px-4 text-left transition-colors active:bg-white/10"
						>
							<Coins aria-hidden="true" className="size-5 text-amber-300/90" />
							<span className="flex-1">
								<span className="block text-base font-medium tabular-nums text-white">
									{points}
								</span>
								<span className="block text-xs text-white/50">Buy more points</span>
							</span>
							<ChevronRight aria-hidden="true" className="size-4 text-white/40" />
						</button>

						<nav aria-label="Account" className="-mx-2 flex flex-col">
							{accountLinks(routes).map(({ path, label, Icon }) => (
								<LinkComponent
									key={path}
									to={path}
									onClick={() => setAccountOpen(false)}
									className={accountRowClassName}
								>
									<Icon aria-hidden="true" className="size-5 text-white/60" />
									<span className="flex-1">{label}</span>
									<ChevronRight aria-hidden="true" className="size-4 text-white/30" />
								</LinkComponent>
							))}
							<a
								href={BUG_REPORT_URL}
								target="_blank"
								rel="noopener noreferrer"
								className={accountRowClassName}
							>
								<Bug aria-hidden="true" className="size-5 text-white/60" />
								<span className="flex-1">Report a bug</span>
							</a>
							<button
								type="button"
								disabled={signingOut}
								onClick={() => void onSignOut()}
								className={cn(accountRowClassName, "text-red-400 disabled:opacity-60")}
							>
								<LogOut aria-hidden="true" className="size-5" />
								<span className="flex-1 text-left">
									{signingOut ? "Signing out..." : "Sign Out"}
								</span>
							</button>
						</nav>
					</SheetContent>
				</Sheet>
			)}
		</>
	);
}

const accountRowClassName =
	"flex min-h-12 items-center gap-3 rounded-lg px-2 text-base text-white/85 transition-colors active:bg-white/10";
