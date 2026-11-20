import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defaultCv, type Cv } from '@/lib/cv';

type Item = {
  id: number;
  category: string;
  title: string;
  description: string;
  price: number | null;
  imageUrl: string | null;
  createdAt: string;
};

type Inquiry = {
  id: number;
  name: string;
  email: string;
  message: string;
  createdAt: string;
};

export type SiteSettings = {
  contactEmail: string | null;
  etsyUrl: string | null;
  teachingUrl: string | null;
  cv: Cv;
};

type Store = {
  items: Item[];
  inquiries: Inquiry[];
  settings: SiteSettings;
  nextItemId: number;
  nextInquiryId: number;
};

const dataFile = process.env.AK_DATA_FILE || '/tmp/akcreations-data.json';
let storePromise: Promise<Store> | undefined;
let writeQueue: Promise<void> = Promise.resolve();

function emptyStore(): Store {
  return {
    items: [],
    inquiries: [],
    settings: { contactEmail: null, etsyUrl: null, teachingUrl: null, cv: defaultCv },
    nextItemId: 1,
    nextInquiryId: 1,
  };
}

async function loadStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = readFile(dataFile, 'utf8')
      .then((contents) => ({ ...emptyStore(), ...JSON.parse(contents) }) as Store)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') console.error('Could not read temporary app data; starting empty.', error);
        return emptyStore();
      });
  }
  return storePromise;
}

async function persist(store: Store) {
  await mkdir(path.dirname(dataFile), { recursive: true });
  const tempFile = `${dataFile}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempFile, JSON.stringify(store), 'utf8');
  await rename(tempFile, dataFile);
}

async function read<T>(fn: (store: Store) => T): Promise<T> {
  await writeQueue;
  const result = fn(await loadStore());
  return JSON.parse(JSON.stringify(result)) as T;
}

async function update<T>(fn: (store: Store) => T): Promise<T> {
  const operation = writeQueue.then(async () => {
    const store = await loadStore();
    const result = fn(store);
    await persist(store);
    return JSON.parse(JSON.stringify(result)) as T;
  });
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export const listItems = () => read((store) => [...store.items].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)));
export const listInquiries = (limit = 20) => read((store) => [...store.inquiries].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, limit));
export const getSiteSettings = () => read((store) => store.settings);

export function createItem(input: Omit<Item, 'id' | 'createdAt'>) {
  return update((store) => {
    const item: Item = { ...input, id: store.nextItemId++, createdAt: new Date().toISOString() };
    store.items.push(item);
    return item;
  });
}

export function deleteItem(id: number) {
  return update((store) => {
    const previousLength = store.items.length;
    store.items = store.items.filter((item) => item.id !== id);
    return store.items.length !== previousLength;
  });
}

export function createInquiry(input: Pick<Inquiry, 'name' | 'email' | 'message'>) {
  return update((store) => {
    const inquiry: Inquiry = { ...input, id: store.nextInquiryId++, createdAt: new Date().toISOString() };
    store.inquiries.push(inquiry);
    return inquiry;
  });
}

export function updateSiteSettings(patch: Partial<SiteSettings>) {
  return update((store) => {
    store.settings = { ...store.settings, ...patch };
    return store.settings;
  });
}
