import { AISettings as AISettingsView } from "@slidesage/ui/components/Settings/AISettings";
import {
	connectAIProvider,
	deleteAIProvider,
	selectAIModel,
	setAIConnectionEnabled,
} from "@slidesage/ui/lib/ai-connections";
import { takeAIConfiguration } from "./settings-data";

export function AISettings() {
	return (
		<AISettingsView
			fetchConfiguration={takeAIConfiguration}
			connectProvider={connectAIProvider}
			deleteProvider={deleteAIProvider}
			selectModel={selectAIModel}
			setProviderEnabled={setAIConnectionEnabled}
		/>
	);
}
