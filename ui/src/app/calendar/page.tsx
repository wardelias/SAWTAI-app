"use client";

import { format, isSameDay } from "date-fns";
import { Bot, CalendarDays, Clock, Loader2, Phone, Plus, Trash2, User } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
    createMeetingApiV1MeetingsPost,
    deleteMeetingApiV1MeetingsMeetingIdDelete,
    listMeetingsApiV1MeetingsGet,
    type MeetingResponse,
} from "@/client/meeting";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export default function CalendarPage() {
    const { user, loading: authLoading } = useAuth();
    const hasFetched = useRef(false);

    const [meetings, setMeetings] = useState<MeetingResponse[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
    const [dialogOpen, setDialogOpen] = useState(false);

    const fetchMeetings = useCallback(async () => {
        setIsLoading(true);
        try {
            const response = await listMeetingsApiV1MeetingsGet();
            if (response.data) setMeetings(response.data.meetings);
        } catch (error) {
            console.error("Failed to fetch meetings:", error);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (authLoading || !user || hasFetched.current) return;
        hasFetched.current = true;
        fetchMeetings();
    }, [authLoading, user, fetchMeetings]);

    const dayMeetings = useMemo(() => {
        if (!selectedDate) return [];
        return meetings
            .filter((m) => isSameDay(new Date(m.start_time), selectedDate))
            .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
    }, [meetings, selectedDate]);

    const meetingDays = useMemo(
        () => meetings.map((m) => new Date(m.start_time)),
        [meetings],
    );

    const handleDelete = async (id: number) => {
        try {
            await deleteMeetingApiV1MeetingsMeetingIdDelete({ path: { meeting_id: id } });
            setMeetings((prev) => prev.filter((m) => m.id !== id));
        } catch (error) {
            console.error("Failed to delete meeting:", error);
        }
    };

    const handleCreate = async (meeting: MeetingResponse) => {
        setMeetings((prev) => [...prev, meeting]);
        setSelectedDate(new Date(meeting.start_time));
        setDialogOpen(false);
    };

    return (
        <div className="container mx-auto px-4 py-8">
            <div className="mb-6 flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
                    <p className="text-sm text-muted-foreground">
                        Meetings booked by your voice agents land here automatically. You can also add bookings manually.
                    </p>
                </div>
                <BookMeetingDialog
                    open={dialogOpen}
                    onOpenChange={setDialogOpen}
                    defaultDate={selectedDate}
                    onCreate={handleCreate}
                />
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[auto_1fr]">
                <Card>
                    <CardContent className="p-3">
                        <Calendar
                            mode="single"
                            selected={selectedDate}
                            onSelect={setSelectedDate}
                            modifiers={{ booked: meetingDays }}
                            modifiersClassNames={{
                                booked: "after:absolute after:bottom-1 after:left-1/2 after:-translate-x-1/2 after:w-1 after:h-1 after:rounded-full after:bg-primary",
                            }}
                            className="[--cell-size:--spacing(10)]"
                        />
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                        <div>
                            <CardTitle className="flex items-center gap-2">
                                <CalendarDays className="h-4 w-4" />
                                {selectedDate ? format(selectedDate, "EEEE, MMMM d, yyyy") : "Pick a day"}
                            </CardTitle>
                            <CardDescription>
                                {isLoading ? "Loading…" : dayMeetings.length === 0
                                    ? "No meetings on this day."
                                    : `${dayMeetings.length} meeting${dayMeetings.length === 1 ? "" : "s"} scheduled.`}
                            </CardDescription>
                        </div>
                        {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                    </CardHeader>
                    <CardContent>
                        {isLoading ? (
                            <div className="space-y-2">
                                {Array.from({ length: 3 }).map((_, i) => (
                                    <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
                                ))}
                            </div>
                        ) : dayMeetings.length === 0 ? (
                            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                                Nothing here yet. When a voice agent books a meeting it will appear here automatically.
                            </div>
                        ) : (
                            <ul className="space-y-3">
                                {dayMeetings.map((meeting) => (
                                    <MeetingRow
                                        key={meeting.id}
                                        meeting={meeting}
                                        onDelete={handleDelete}
                                    />
                                ))}
                            </ul>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

function MeetingRow({
    meeting,
    onDelete,
}: {
    meeting: MeetingResponse;
    onDelete: (id: number) => void;
}) {
    const [deleting, setDeleting] = useState(false);

    const handleDelete = async () => {
        setDeleting(true);
        await onDelete(meeting.id);
        setDeleting(false);
    };

    return (
        <li className="flex items-start justify-between gap-4 rounded-md border p-4">
            <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2">
                    <p className="truncate font-medium">{meeting.title}</p>
                    <span
                        className={cn(
                            "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                            meeting.booked_by === "agent"
                                ? "bg-primary/10 text-primary"
                                : "bg-muted text-muted-foreground"
                        )}
                    >
                        {meeting.booked_by === "agent" ? (
                            <><Bot className="h-3 w-3" />Voice agent</>
                        ) : (
                            "Manual"
                        )}
                    </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {format(new Date(meeting.start_time), "h:mm a")} · {meeting.duration_minutes} min
                    </span>
                    <span className="inline-flex items-center gap-1">
                        <User className="h-3.5 w-3.5" />
                        {meeting.attendee}
                    </span>
                    {meeting.phone && (
                        <span className="inline-flex items-center gap-1">
                            <Phone className="h-3.5 w-3.5" />
                            {meeting.phone}
                        </span>
                    )}
                </div>
                {meeting.notes && (
                    <p className="pt-1 text-sm text-muted-foreground">{meeting.notes}</p>
                )}
                {meeting.workflow_run_id && (
                    <p className="text-xs text-muted-foreground">
                        Booked during run <span className="font-mono">#{meeting.workflow_run_id}</span>
                    </p>
                )}
            </div>
            <Button
                variant="ghost"
                size="icon"
                onClick={handleDelete}
                disabled={deleting}
                aria-label="Delete meeting"
            >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </Button>
        </li>
    );
}

interface BookMeetingDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    defaultDate: Date | undefined;
    onCreate: (meeting: MeetingResponse) => void;
}

function BookMeetingDialog({ open, onOpenChange, defaultDate, onCreate }: BookMeetingDialogProps) {
    const initialDateStr = (defaultDate ?? new Date()).toISOString().slice(0, 10);

    const [title, setTitle] = useState("");
    const [attendee, setAttendee] = useState("");
    const [phone, setPhone] = useState("");
    const [date, setDate] = useState(initialDateStr);
    const [time, setTime] = useState("10:00");
    const [duration, setDuration] = useState(30);
    const [notes, setNotes] = useState("");
    const [saving, setSaving] = useState(false);

    const reset = () => {
        setTitle("");
        setAttendee("");
        setPhone("");
        setDate((defaultDate ?? new Date()).toISOString().slice(0, 10));
        setTime("10:00");
        setDuration(30);
        setNotes("");
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!title.trim() || !attendee.trim()) return;
        setSaving(true);

        const [year, month, day] = date.split("-").map(Number);
        const [hours, minutes] = time.split(":").map(Number);
        const startDate = new Date(year, month - 1, day, hours, minutes);

        try {
            const response = await createMeetingApiV1MeetingsPost({
                body: {
                    title: title.trim(),
                    attendee: attendee.trim(),
                    phone: phone.trim() || null,
                    notes: notes.trim() || null,
                    start_time: startDate.toISOString(),
                    duration_minutes: duration,
                    booked_by: "user",
                },
            });
            if (response.data) {
                onCreate(response.data);
                reset();
            }
        } catch (error) {
            console.error("Failed to create meeting:", error);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) reset();
                onOpenChange(next);
            }}
        >
            <DialogTrigger asChild>
                <Button>
                    <Plus className="mr-1 h-4 w-4" />
                    Book meeting
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>Book a meeting</DialogTitle>
                        <DialogDescription>
                            Add a meeting to the calendar. Voice agents use this same calendar when they book on a caller&apos;s behalf.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label htmlFor="meeting-title">Title</Label>
                            <Input id="meeting-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Discovery call" required />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="meeting-attendee">Attendee</Label>
                            <Input id="meeting-attendee" value={attendee} onChange={(e) => setAttendee(e.target.value)} placeholder="Jane Doe — Acme Co." required />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="meeting-phone">Phone (optional)</Label>
                            <Input id="meeting-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 0100" />
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            <div className="grid gap-2">
                                <Label htmlFor="meeting-date">Date</Label>
                                <Input id="meeting-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="meeting-time">Time</Label>
                                <Input id="meeting-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="meeting-duration">Minutes</Label>
                                <Input id="meeting-duration" type="number" min={5} max={480} step={5} value={duration} onChange={(e) => setDuration(Number(e.target.value) || 30)} required />
                            </div>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="meeting-notes">Notes</Label>
                            <Textarea id="meeting-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the agent or attendee should know" rows={3} />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={saving}>
                            {saving ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" />Saving…</> : "Book"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
