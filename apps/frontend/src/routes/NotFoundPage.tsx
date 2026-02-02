import { Link } from "react-router-dom";

export default function NotFoundPage() {
	return (
		<div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center px-6">
			<div className="max-w-xl w-full text-center border border-white/10 bg-white/5 backdrop-blur-md rounded-2xl p-10 shadow-2xl">
				<div className="text-white text-5xl font-bold">404</div>
				<div className="text-white/80 text-lg mt-3">Page not found</div>
				<p className="text-white/60 mt-4">
					The page you’re looking for doesn’t exist or was moved.
				</p>

				<div className="mt-8 flex items-center justify-center gap-3">
					<Link
						to="/"
						className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 text-white transition"
					>
						Go Home
					</Link>
					<Link
						to="/presentations"
						className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 text-white transition"
					>
						Presentations
					</Link>
				</div>
			</div>
		</div>
	);
}
