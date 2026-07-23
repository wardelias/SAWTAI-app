"use client";

import { Plus, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import CsvUploadSelector from '@/app/campaigns/CsvUploadSelector';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { detailFromError } from '@/lib/apiError';
import { useAuth } from '@/lib/auth';
import {
    createLead,
    importLeads,
    type Lead,
    type LeadListResponse,
    listLeads,
} from '@/lib/leadsApi';

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
    new: 'secondary',
    enrolled: 'default',
    contacted: 'outline',
    responded: 'default',
    qualified: 'default',
    converted: 'default',
    unresponsive: 'outline',
    suppressed: 'destructive',
};

export default function LeadsPage() {
    const { user, getAccessToken, redirectToLogin, loading: authLoading } = useAuth();
    const router = useRouter();

    const [data, setData] = useState<LeadListResponse | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [search, setSearch] = useState('');
    const hasFetched = useRef(false);

    const [importOpen, setImportOpen] = useState(false);
    const [importFileKey, setImportFileKey] = useState<string | null>(null);
    const [importFileName, setImportFileName] = useState<string>('');
    const [importing, setImporting] = useState(false);

    const [createOpen, setCreateOpen] = useState(false);
    const [newPhone, setNewPhone] = useState('');
    const [newFirst, setNewFirst] = useState('');
    const [newLast, setNewLast] = useState('');
    const [newEmail, setNewEmail] = useState('');
    const [newConsentSms, setNewConsentSms] = useState(false);
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        if (!authLoading && !user) redirectToLogin();
    }, [authLoading, user, redirectToLogin]);

    const fetchLeads = async () => {
        setIsLoading(true);
        try {
            const token = await getAccessToken();
            const res = await listLeads(token, {
                search: search || undefined,
                limit: 200,
            });
            if (res.error) {
                toast.error(detailFromError(res.error, 'Failed to load leads'));
                return;
            }
            setData(res.data ?? null);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (authLoading || !user || hasFetched.current) return;
        hasFetched.current = true;
        fetchLeads();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authLoading, user]);

    const handleImport = async () => {
        if (!importFileKey) return;
        setImporting(true);
        try {
            const token = await getAccessToken();
            const res = await importLeads(token, importFileKey);
            if (res.error) {
                toast.error(detailFromError(res.error, 'Import failed'));
                return;
            }
            const r = res.data!;
            toast.success(
                `Imported ${r.imported} leads (${r.duplicates_in_db + r.duplicates_in_file} duplicates skipped, ${r.invalid} invalid)`,
            );
            setImportOpen(false);
            setImportFileKey(null);
            setImportFileName('');
            await fetchLeads();
        } finally {
            setImporting(false);
        }
    };

    const handleCreate = async () => {
        if (!newPhone.startsWith('+')) {
            toast.error('Phone number must include country code (start with +)');
            return;
        }
        setCreating(true);
        try {
            const token = await getAccessToken();
            const res = await createLead(token, {
                phone_number: newPhone,
                first_name: newFirst || undefined,
                last_name: newLast || undefined,
                email: newEmail || undefined,
                consent_sms: newConsentSms,
            });
            if (res.error) {
                toast.error(detailFromError(res.error, 'Failed to create lead'));
                return;
            }
            toast.success('Lead created');
            setCreateOpen(false);
            setNewPhone('');
            setNewFirst('');
            setNewLast('');
            setNewEmail('');
            setNewConsentSms(false);
            await fetchLeads();
        } finally {
            setCreating(false);
        }
    };

    const formatDate = (d: string | null) => (d ? new Date(d).toLocaleDateString() : '—');
    const leadName = (l: Lead) =>
        [l.first_name, l.last_name].filter(Boolean).join(' ') || '—';

    return (
        <div className="container mx-auto p-6 space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold mb-2">Leads</h1>
                    <p>Your persistent contact database for reactivation campaigns</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setImportOpen(true)}>
                        <Upload className="h-4 w-4 mr-2" />
                        Import CSV
                    </Button>
                    <Button onClick={() => setCreateOpen(true)}>
                        <Plus className="h-4 w-4 mr-2" />
                        Add Lead
                    </Button>
                </div>
            </div>

            {data && Object.keys(data.status_counts).length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {Object.entries(data.status_counts).map(([status, count]) => (
                        <Badge key={status} variant={STATUS_VARIANTS[status] ?? 'secondary'}>
                            {status}: {count}
                        </Badge>
                    ))}
                </div>
            )}

            <Card>
                <CardHeader>
                    <CardTitle>All Leads</CardTitle>
                    <CardDescription>
                        {data ? `${data.total} total` : 'View and manage your leads'}
                    </CardDescription>
                    <div className="flex gap-2 pt-2">
                        <Input
                            placeholder="Search name, phone or email…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && fetchLeads()}
                            className="max-w-xs"
                        />
                        <Button variant="outline" onClick={fetchLeads}>
                            Search
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <div className="animate-pulse space-y-3">
                            {[...Array(5)].map((_, i) => (
                                <div key={i} className="h-12 bg-muted rounded"></div>
                            ))}
                        </div>
                    ) : data && data.leads.length > 0 ? (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Name</TableHead>
                                        <TableHead>Phone</TableHead>
                                        <TableHead>Email</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead>Consent</TableHead>
                                        <TableHead>Last contacted</TableHead>
                                        <TableHead className="text-right">Action</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {data.leads.map((lead) => (
                                        <TableRow
                                            key={lead.id}
                                            className="cursor-pointer hover:bg-muted/50"
                                            onClick={() => router.push(`/leads/${lead.id}`)}
                                        >
                                            <TableCell className="font-medium">{leadName(lead)}</TableCell>
                                            <TableCell>{lead.phone_number}</TableCell>
                                            <TableCell>{lead.email ?? '—'}</TableCell>
                                            <TableCell>
                                                <Badge variant={STATUS_VARIANTS[lead.status] ?? 'secondary'}>
                                                    {lead.status}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>
                                                {lead.dnc ? (
                                                    <Badge variant="destructive">DNC</Badge>
                                                ) : (
                                                    <span className="text-xs text-muted-foreground">
                                                        {[lead.consent_sms && 'SMS', lead.consent_email && 'Email']
                                                            .filter(Boolean)
                                                            .join(', ') || '—'}
                                                    </span>
                                                )}
                                            </TableCell>
                                            <TableCell>{formatDate(lead.last_contacted_at)}</TableCell>
                                            <TableCell className="text-right">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        router.push(`/leads/${lead.id}`);
                                                    }}
                                                >
                                                    View
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    ) : (
                        <div className="text-center py-12 text-muted-foreground">
                            No leads yet. Import a CSV to get started.
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Import dialog */}
            <Dialog open={importOpen} onOpenChange={setImportOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Import leads from CSV</DialogTitle>
                        <DialogDescription>
                            The CSV must have a <code>phone_number</code> column (E.164, e.g.
                            +14155550100). Recognised columns: email, first_name, last_name,
                            timezone, dnc, consent_sms, consent_email. Any other column is kept
                            as a lead attribute the AI agent can use on calls.
                        </DialogDescription>
                    </DialogHeader>
                    <CsvUploadSelector
                        onFileUploaded={(fileKey, fileName) => {
                            setImportFileKey(fileKey);
                            setImportFileName(fileName);
                        }}
                        selectedFileName={importFileName}
                    />
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setImportOpen(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleImport} disabled={!importFileKey || importing}>
                            {importing ? 'Importing…' : 'Import'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Create dialog */}
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Add a lead</DialogTitle>
                        <DialogDescription>Manually add a single contact.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div>
                            <Label htmlFor="phone">Phone number *</Label>
                            <Input
                                id="phone"
                                placeholder="+14155550100"
                                value={newPhone}
                                onChange={(e) => setNewPhone(e.target.value)}
                            />
                        </div>
                        <div className="flex gap-2">
                            <div className="flex-1">
                                <Label htmlFor="first">First name</Label>
                                <Input id="first" value={newFirst} onChange={(e) => setNewFirst(e.target.value)} />
                            </div>
                            <div className="flex-1">
                                <Label htmlFor="last">Last name</Label>
                                <Input id="last" value={newLast} onChange={(e) => setNewLast(e.target.value)} />
                            </div>
                        </div>
                        <div>
                            <Label htmlFor="email">Email</Label>
                            <Input id="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
                        </div>
                        <div className="flex items-center gap-2">
                            <Checkbox
                                id="consent"
                                checked={newConsentSms}
                                onCheckedChange={(v) => setNewConsentSms(Boolean(v))}
                            />
                            <Label htmlFor="consent">Has consented to SMS</Label>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCreateOpen(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleCreate} disabled={creating}>
                            {creating ? 'Adding…' : 'Add lead'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
