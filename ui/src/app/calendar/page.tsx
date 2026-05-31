"use client";

import { format, isSameDay } from "date-fns";
import { CalendarDays, Clock, Phone, Plus, Trash2, User } from "lucide-react";
import { useMemo, useState } from "react";

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

type Meeting = {
    id: string;
    title: string;
    attendee: string;
    phone?: string;
    notes?: string;
    start: Date;
    durationMinutes: number;
    bookedBy: "agent" | "user";
};

const seedMeetings: Meeting[] = [
    {
        id: "m-1",
        title: "Discovery call",
        attendee: "Acme Co. — Jane Doe",
        phone: "+1 555 0142",
        notes: "Caller asked for a follow-up after the demo.",
        start: new Date(new Date().setHours(10, 30, 0, 0)),
        durationMinutes: 30,
        bookedBy: "agent",
    },
    {
        id: "m-2",
        title: "Renewal review",
        attendee: "Globex — Sam Patel",
        phone: "+1 555 0188",
        start: new Date(new Date().setHours(15, 0, 0, 0)),
        durationMinutes: 45,
        bookedBy: "agent",
    },
];

export default function CalendarPage() {
    const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
    const [meetings, setMeetings] = useState<Meeting[]>(seedMeetings);
    const [dialogOpen, setDialogOpen] = useState(false);

    const dayMeetings = useMemo(() => {
        if (!selectedDate) return [];
        return meetings
            .filter((m) => isSameDay(m.start, selectedDate))
            .sort((a, b) => a.start.getTime() - b.start.getTime());
    }, [meetings, selectedDate]);

    const meetingDays = useMemo(
        () => meetings.map((m) => new Date(m.start.getFullYear(), m.start.getMonth(), m.start.getDate())),
        [meetings],
    );

    const handleDelete = (id: string) => {
        setMeetings((prev) => prev.filter((m) => m.id !== id));
    };

    return (
        <div className="container mx-auto px-4 py-8">
            <div className="mb-6 flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
                    <p className="text-sm text-muted-foreground">
                        Meetings booked by your voice agents land here. You can also add bookings manually.
                    </p>
                </div>
                <BookMeetingDialog
                    open={dialogOpen}
                    onOpenChange={setDialogOpen}
                    defaultDate={selectedDate}
                    onCreate={(meeting) => {
                        setMeetings((prev) => [...prev, meeting]);
                        setSelectedDate(meeting.start);
                        setDialogOpen(false);
                    }}
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
                                {dayMeetings.length === 0
                                    ? "No meetings on this day."
                                    : `${dayMeetings.length} meeting${dayMeetings.length === 1 ? "" : "s"} scheduled.`}
                            </CardDescription>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {dayMeetings.length === 0 ? (
                            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                                Nothing here yet. When a voice agent books a meeting, it will show up on the day it was scheduled for.
                            </div>
                        ) : (
                            <ul className="space-y-3">
                                {dayMeetings.map((meeting) => (
                                    <li
                                        key={meeting.id}
                                        className="flex items-start justify-between gap-4 rounded-md border p-4"
                                    >
                                        <div className="min-w-0 flex-1 space-y-1">
                                            <div className="flex items-center gap-2">
                                                <p className="truncate font-medium">{meeting.title}</p>
                                                <span
                                                    className={
                                                        meeting.bookedBy === "agent"
                                                            ? "inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary"
                                                            : "inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                                                    }
                                                >
                                                    {meeting.bookedBy === "agent" ? "Voice agent" : "Manual"}
                                                </span>
                                            </div>
                                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                                                <span className="inline-flex items-center gap-1">
                                                    <Clock className="h-3.5 w-3.5" />
                                                    {format(meeting.start, "h:mm a")} · {meeting.durationMinutes} min
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
                                        </div>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => handleDelete(meeting.id)}
                                            aria-label="Delete meeting"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

interface BookMeetingDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    defaultDate: Date | undefined;
    onCreate: (meeting: Meeting) => void;
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

    const reset = () => {
        setTitle("");
        setAttendee("");
        setPhone("");
        setDate((defaultDate ?? new Date()).toISOString().slice(0, 10));
        setTime("10:00");
        setDuration(30);
        setNotes("");
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!title.trim() || !attendee.trim()) return;
        const [year, month, day] = date.split("-").map(Number);
        const [hours, minutes] = time.split(":").map(Number);
        const start = new Date(year, month - 1, day, hours, minutes);
        onCreate({
            id: `m-${Date.now()}`,
            title: title.trim(),
            attendee: attendee.trim(),
            phone: phone.trim() || undefined,
            notes: notes.trim() || undefined,
            start,
            durationMinutes: duration,
            bookedBy: "user",
        });
        reset();
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
                            <Input
                                id="meeting-title"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                placeholder="Discovery call"
                                required
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="meeting-attendee">Attendee</Label>
                            <Input
                                id="meeting-attendee"
                                value={attendee}
                                onChange={(e) => setAttendee(e.target.value)}
                                placeholder="Jane Doe — Acme Co."
                                required
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="meeting-phone">Phone (optional)</Label>
                            <Input
                                id="meeting-phone"
                                value={phone}
                                onChange={(e) => setPhone(e.target.value)}
                                placeholder="+1 555 0100"
                            />
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            <div className="grid gap-2">
                                <Label htmlFor="meeting-date">Date</Label>
                                <Input
                                    id="meeting-date"
                                    type="date"
                                    value={date}
                                    onChange={(e) => setDate(e.target.value)}
                                    required
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="meeting-time">Time</Label>
                                <Input
                                    id="meeting-time"
                                    type="time"
                                    value={time}
                                    onChange={(e) => setTime(e.target.value)}
                                    required
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="meeting-duration">Minutes</Label>
                                <Input
                                    id="meeting-duration"
                                    type="number"
                                    min={5}
                                    max={480}
                                    step={5}
                                    value={duration}
                                    onChange={(e) => setDuration(Number(e.target.value) || 30)}
                                    required
                                />
                            </div>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="meeting-notes">Notes</Label>
                            <Textarea
                                id="meeting-notes"
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                placeholder="Anything the agent or attendee should know"
                                rows={3}
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button type="submit">Book</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
