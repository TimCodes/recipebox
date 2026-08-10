import { format, startOfWeek, addWeeks, subWeeks } from 'date-fns';

export function getWeekStart(date: Date = new Date()): string {
  return format(startOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd');
}

export function formatWeekRange(weekStartStr: string): string {
  const start = new Date(weekStartStr);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  
  if (start.getMonth() === end.getMonth()) {
    return `${format(start, 'MMMM d')} - ${format(end, 'd, yyyy')}`;
  }
  return `${format(start, 'MMM d')} - ${format(end, 'MMM d, yyyy')}`;
}

export function getNextWeekStart(weekStartStr: string): string {
  return format(addWeeks(new Date(weekStartStr), 1), 'yyyy-MM-dd');
}

export function getPrevWeekStart(weekStartStr: string): string {
  return format(subWeeks(new Date(weekStartStr), 1), 'yyyy-MM-dd');
}
