import { SETTINGS_DOCUMENTATION_URLS } from "@/constants/documentation";

import { ModelsPageContent } from "./ModelsPageContent";

export default function ServiceConfigurationPage() {
    return (
        <div className="min-h-screen">
            <div className="container mx-auto px-4 py-8 max-md:py-5">
                <div className="max-w-4xl mx-auto">
                    <ModelsPageContent docsUrl={SETTINGS_DOCUMENTATION_URLS.modelOverrides} />
                </div>
            </div>
        </div>
    );
}
