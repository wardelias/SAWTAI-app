"use client";

import { Zap } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function AutomationPage() {
    return (
        <div className="container mx-auto p-6 space-y-6 max-md:space-y-5 max-md:px-4 max-md:py-5">
            <div>
                <h1 className="text-3xl font-bold mb-2 max-md:text-2xl">Automation</h1>
                <p className="max-md:text-sm max-md:text-muted-foreground">Automate your workflows and processes</p>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Coming Soon</CardTitle>
                    <CardDescription>
                        Automation features are currently under development
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="text-center py-12">
                        <Zap className="w-16 h-16 mx-auto mb-6" />
                        <p className="text-lg mb-4">
                            We&apos;re working on powerful automation features to help you streamline your workflows.
                        </p>
                        <p>
                            Automate repetitive tasks, trigger actions based on events, and create intelligent workflow pipelines.
                        </p>
                        <p className="mt-4">
                            Check back soon for updates!
                        </p>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
