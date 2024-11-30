import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { isObject } from './util/isObject';
import EventEmitter from 'eventemitter3';

export type LogUpdate = {
  type: 'log';
  data: LogData;
};

export type LogData = {
  time: number;
  level: string;
  message: string;
  label?: string;
};

const updates = new EventEmitter();

export function isLogUpdate(message: any): message is LogUpdate {
  if (!isObject(message)) return false;
  if (message.type !== 'log') return false;

  // Some basic validation
  if (!isObject(message.data)) return false;
  if (typeof message.data.time !== 'number') return false;
  if (typeof message.data.level !== 'string') return false;
  if (typeof message.data.message !== 'string') return false;
  if (typeof (message.data.label ?? '') !== 'string') return false;

  // TODO: actually validate the data
  return true;
}

const history: LogData[] = [];

export function handleLogUpdate(update: LogUpdate) {
  if (!isLogUpdate(update)) {
    console.error('Invalid log update:', update);
    return;
  }

  history.push(update.data);

  updates.emit('update', update.data);

  // console.log('Got update:', update.data);
}

export function useLogLabels() {
  const [labels, setLabels] = useState<string[]>([]);

  useEffect(() => {
    function handleUpdate({ label }: LogData) {
      if (label && !labels.includes(label)) {
        console.log('Adding label:', label);
        setLabels([...labels, label]);
      }
    }

    updates.on('update', handleUpdate);
    return () => {
      updates.off('update', handleUpdate);
    };
  }, [setLabels, labels]);

  return labels;
}

export function useLogs(isIncluded: (update: LogData) => boolean) {
  const [logs, setLogs] = useState<LogData[]>([]);

  useEffect(() => {
    function filteredChange(update: LogData) {
      if (isIncluded(update)) setLogs([...logs, update]);
    }

    updates.on('update', filteredChange);
    return () => {
      updates.off('update', filteredChange);
    };
  }, [isIncluded, logs, setLogs]);

  return logs;
}

export function useLogsStore(isIncluded: (update: LogData) => boolean) {
  return useSyncExternalStore<LogData[]>(
    useMemo(
      () => (onStoreChange: () => void) => {
        function filteredChange(update: LogData) {
          if (isIncluded(update)) onStoreChange();
        }

        updates.on('update', filteredChange);
        return () => updates.off('update', filteredChange);
      },
      [isIncluded],
    ),
    useMemo(() => () => history.filter(isIncluded), [history, isIncluded]),
  );
}
