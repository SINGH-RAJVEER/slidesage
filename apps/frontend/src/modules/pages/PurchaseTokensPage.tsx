import { useUser } from "@clerk/clerk-react";
import { ArrowLeft, Check, Coins } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "@/components/Header";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function PurchaseTokensPage() {
	const navigate = useNavigate();
	const { user } = useUser();
	const [customAmount, setCustomAmount] = useState<string>("");
	const [selectedOption, setSelectedOption] = useState<string | null>(null);
	const [isProcessing, setIsProcessing] = useState(false);

	const handlePurchase = async (amount: number, option: string) => {
		setIsProcessing(true);
		setSelectedOption(option);

		// TODO: Implement actual payment processing
		// For now, just simulate a delay
		await new Promise((resolve) => setTimeout(resolve, 1000));

		console.log(`Processing purchase of ${amount} points`);

		// After successful purchase, redirect back
		setIsProcessing(false);
		// navigate("/");
	};

	const handleCustomPurchase = () => {
		const amount = parseInt(customAmount);
		if (amount >= 10 && amount <= 1000) {
			handlePurchase(amount, "custom");
		}
	};

	const isCustomAmountValid = () => {
		const amount = parseInt(customAmount);
		return !isNaN(amount) && amount >= 10 && amount <= 1000;
	};

	const calculateCustomPrice = (amountStr: string) => {
		const amount = parseInt(amountStr);
		if (isNaN(amount)) return 0;
		let price = amount * 5;
		if (amount > 250) {
			price = price * 0.8; // 20% discount for >250
		} else if (amount > 100) {
			price = price * 0.9; // 10% discount for >100
		}
		return price;
	};

	return (
		<div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
			<Header />

			{/* Main Content */}
			<div className="container mx-auto px-4 py-12">
				<div className="max-w-[1600px] mx-auto">
					{/* Page Title */}
					<div className="mb-8 flex items-center gap-4">
						<div className="relative group">
							<Button
								variant="outline"
								onClick={() => navigate(-1)}
								className="bg-white/10 border-white/20 text-white hover:bg-white/20 transition-all duration-200"
							>
								<ArrowLeft className="w-4 h-4" />
							</Button>
							<div className="absolute top-full left-0 mt-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50">
								<div className="bg-white/10 backdrop-blur-lg border border-white/30 text-white px-4 py-2 rounded-lg shadow-lg whitespace-nowrap">
									Back to Generated
								</div>
							</div>
						</div>
						<h1 className="text-4xl font-bold text-white flex items-center gap-3">
							Purchase Points
						</h1>
					</div>

					<div className="flex justify-center mb-20">
						<div className="bg-white/5 border border-white/10 rounded-2xl p-8 backdrop-blur-sm text-center min-w-[300px] shadow-xl">
							<h2 className="text-white/60 text-lg mb-2 uppercase tracking-wider font-medium">
								Current Balance
							</h2>
							<div className="text-6xl font-bold text-white flex items-center justify-center gap-3">
								{(user?.publicMetadata as any)?.is_unlimited ||
								(user?.publicMetadata as any)?.slide_tokens === Infinity
									? "∞"
									: ((user?.publicMetadata as any)?.slide_tokens?.toFixed(1) ??
										"0.0")}
								<span className="text-2xl text-blue-400 font-normal mt-4">
									points
								</span>
							</div>
							{((user as any)?.is_unlimited ||
								user?.slide_tokens === Infinity) && (
								<div className="mt-3 text-sm text-green-400 font-medium">
									Unlimited Access
								</div>
							)}
						</div>
					</div>

					{/* Purchase Options */}
					<div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8 mb-8">
						{/* Option 1: 10 Tokens */}
						<Card className="shadow-2xl border border-white/20 bg-white/10 backdrop-blur-md hover:border-white/40 transition-all flex flex-col">
							<CardHeader>
								<CardTitle className="text-white text-2xl">
									Starter Pack
								</CardTitle>
								<CardDescription className="text-white/60">
									Perfect for trying out
								</CardDescription>
							</CardHeader>
							<CardContent className="flex-1 flex flex-col">
								<div className="flex-1 space-y-4">
									<div className="text-center py-4">
										<div className="text-5xl font-bold text-white mb-2">10</div>
										<div className="text-white/60">points</div>
									</div>
									<div className="text-center text-3xl font-bold text-blue-400">
										₹50
									</div>
									<div className="pt-4 space-y-3 border-t border-white/10 mt-6">
										<div className="text-sm text-white/70">
											<span className="text-white/50">
												• Standard generation speed
											</span>
										</div>
										<div className="text-sm text-white/70">
											<span className="text-white/50">• Standard support</span>
										</div>
									</div>
								</div>
								<Button
									className="w-full bg-white/10 hover:bg-white/20 backdrop-blur-lg border border-white/30 text-white shadow-[0_8px_32px_0_rgba(255,255,255,0.1)] transition-all duration-300 hover:shadow-[0_8px_32px_0_rgba(255,255,255,0.2)] h-12 font-semibold mt-4"
									onClick={() => handlePurchase(10, "starter")}
									disabled={isProcessing}
								>
									{isProcessing && selectedOption === "starter" ? (
										"Processing..."
									) : (
										<>
											<Check className="h-4 w-4 mr-2" />
											Purchase
										</>
									)}
								</Button>
							</CardContent>
						</Card>

						{/* Option 2: 100 Tokens */}
						<Card className="shadow-2xl border border-white/20 bg-white/10 backdrop-blur-md hover:border-white/40 transition-all relative flex flex-col">
							<CardHeader>
								<CardTitle className="text-white text-2xl">Pro Pack</CardTitle>
								<CardDescription className="text-white/60">
									Most popular choice
								</CardDescription>
							</CardHeader>
							<CardContent className="flex-1 flex flex-col">
								<div className="flex-1 space-y-4">
									<div className="text-center py-4">
										<div className="text-5xl font-bold text-white mb-2">
											100
										</div>
										<div className="text-white/60">points</div>
									</div>
									<div className="text-center">
										<div className="text-3xl font-bold text-blue-400">₹450</div>
										<div className="text-sm text-green-400 mt-1">Save 10%</div>
									</div>
									<div className="pt-4 space-y-3 border-t border-white/10 mt-6">
										<div className="text-sm text-white/80 flex items-start gap-2">
											<span className="text-green-400 mt-0.5">✓</span>
											<span>
												<span className="font-semibold">
													Ad-Free Experience
												</span>{" "}
												(30+ points)
											</span>
										</div>
										<div className="text-sm text-white/70">
											<span className="text-white/50">
												• Standard generation speed
											</span>
										</div>
									</div>
								</div>
								<Button
									className="w-full bg-white/10 hover:bg-white/20 backdrop-blur-lg border border-white/30 text-white shadow-[0_8px_32px_0_rgba(255,255,255,0.1)] transition-all duration-300 hover:shadow-[0_8px_32px_0_rgba(255,255,255,0.2)] h-12 font-semibold mt-4"
									onClick={() => handlePurchase(100, "pro")}
									disabled={isProcessing}
								>
									{isProcessing && selectedOption === "pro" ? (
										"Processing..."
									) : (
										<>
											<Check className="h-4 w-4 mr-2" />
											Purchase
										</>
									)}
								</Button>
							</CardContent>
						</Card>

						{/* Option 3: 250 Tokens */}
						<div className="relative">
							<div className="absolute -top-4 right-4 z-10 bg-white/10 backdrop-blur-lg border border-white/30 text-white text-xs font-bold px-4 py-1.5 rounded-full shadow-[0_8px_32px_0_rgba(255,255,255,0.15)]">
								BEST VALUE
							</div>
							<Card className="shadow-2xl border border-blue-400/50 bg-white/10 backdrop-blur-md hover:border-blue-400 transition-all flex flex-col">
								<CardHeader>
									<CardTitle className="text-white text-2xl">
										Premium Pack
									</CardTitle>
									<CardDescription className="text-white/60">
										Maximum savings
									</CardDescription>
								</CardHeader>
								<CardContent className="flex-1 flex flex-col">
									<div className="flex-1 space-y-4">
										<div className="text-center py-4">
											<div className="text-5xl font-bold text-white mb-2">
												250
											</div>
											<div className="text-white/60">points</div>
										</div>
										<div className="text-center">
											<div className="text-3xl font-bold text-blue-400">
												₹1000
											</div>
											<div className="text-sm text-green-400 mt-1">
												Save 20%
											</div>
										</div>
										<div className="pt-4 space-y-3 border-t border-white/10 mt-6">
											<div className="text-sm text-white/80 flex items-start gap-2">
												<span className="text-green-400 mt-0.5">✓</span>
												<span>
													<span className="font-semibold">
														Ad-Free Experience
													</span>{" "}
													(30+ points)
												</span>
											</div>
											<div className="text-sm text-white/80 flex items-start gap-2">
												<span className="text-green-400 mt-0.5">✓</span>
												<span>
													<span className="font-semibold">
														Priority Throughput
													</span>{" "}
													(100+ points)
												</span>
											</div>
											<div className="text-sm text-white/70">
												<span className="text-white/50">
													• Maximum savings per token
												</span>
											</div>
										</div>
									</div>
									<Button
										className="w-full bg-white/10 hover:bg-white/20 backdrop-blur-lg border border-white/30 text-white shadow-[0_8px_32px_0_rgba(255,255,255,0.1)] transition-all duration-300 hover:shadow-[0_8px_32px_0_rgba(255,255,255,0.2)] h-12 font-semibold mt-4"
										onClick={() => handlePurchase(250, "premium")}
										disabled={isProcessing}
									>
										{isProcessing && selectedOption === "premium" ? (
											"Processing..."
										) : (
											<>
												<Check className="h-4 w-4 mr-2" />
												Purchase
											</>
										)}
									</Button>
								</CardContent>
							</Card>
						</div>

						{/* Option 4: Custom Amount */}
						<Card className="shadow-2xl border border-white/20 bg-white/10 backdrop-blur-md hover:border-white/40 transition-all flex flex-col">
							<CardHeader>
								<CardTitle className="text-white text-2xl">
									Custom Amount
								</CardTitle>
								<CardDescription className="text-white/60">
									Choose your own (10-1000)
								</CardDescription>
							</CardHeader>
							<CardContent className="flex-1 flex flex-col">
								<div className="flex-1 space-y-4">
									<div className="text-center py-4">
										<div className="space-y-2">
											<Input
												id="customAmount"
												type="number"
												min="10"
												max="1000"
												placeholder="Enter number of points"
												value={customAmount}
												onChange={(e) => setCustomAmount(e.target.value)}
												onInput={(e) => {
													const target = e.target as HTMLInputElement;
													if (parseInt(target.value) > 1000) {
														target.value = "1000";
														setCustomAmount("1000");
													}
												}}
												onKeyPress={(e) => {
													if (!/[0-9]/.test(e.key)) {
														e.preventDefault();
													}
												}}
												className="bg-white/5 border-white/20 text-white placeholder:text-white/40 text-center text-5xl h-20 font-bold"
											/>
											{customAmount && !isCustomAmountValid() && (
												<p className="text-red-400 text-sm">Must be 10-1000</p>
											)}
										</div>
									</div>
									{customAmount && isCustomAmountValid() && (
										<div className="text-center">
											<div className="text-3xl font-bold text-blue-400">
												₹{calculateCustomPrice(customAmount).toFixed(0)}
											</div>
											{parseInt(customAmount) > 250 && (
												<div className="text-sm text-green-400 mt-1">
													20% Discount Applied
												</div>
											)}
											{parseInt(customAmount) > 100 &&
												parseInt(customAmount) <= 250 && (
													<div className="text-sm text-green-400 mt-1">
														10% Discount Applied
													</div>
												)}
										</div>
									)}
									{customAmount &&
										isCustomAmountValid() &&
										parseInt(customAmount) >= 30 && (
											<div className="pt-4 space-y-3 border-t border-white/10">
												{parseInt(customAmount) >= 30 && (
													<div className="text-sm text-white/80 flex items-start gap-2">
														<span className="text-green-400 mt-0.5">✓</span>
														<span>
															<span className="font-semibold">
																Ad-Free Experience
															</span>
														</span>
													</div>
												)}
												{parseInt(customAmount) >= 100 && (
													<div className="text-sm text-white/80 flex items-start gap-2">
														<span className="text-green-400 mt-0.5">✓</span>
														<span>
															<span className="font-semibold">
																Priority Throughput
															</span>
														</span>
													</div>
												)}
											</div>
										)}
								</div>
								<Button
									className="w-full bg-white/10 hover:bg-white/20 backdrop-blur-lg border border-white/30 text-white shadow-[0_8px_32px_0_rgba(255,255,255,0.1)] transition-all duration-300 hover:shadow-[0_8px_32px_0_rgba(255,255,255,0.2)] h-12 font-semibold mt-4"
									onClick={handleCustomPurchase}
									disabled={!isCustomAmountValid() || isProcessing}
								>
									{isProcessing && selectedOption === "custom" ? (
										"Processing..."
									) : (
										<>
											<Check className="h-4 w-4 mr-2" />
											Purchase
										</>
									)}
								</Button>
							</CardContent>
						</Card>
					</div>

					{/* Additional Info */}
					<div className="mt-8 text-center text-white/60 text-sm">
						<p>All purchases are secure and encrypted.</p>
						<p className="mt-2">
							Points never expire and can be used for any presentation
							generation.
						</p>
					</div>
				</div>
			</div>
		</div>
	);
}
