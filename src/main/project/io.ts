import fs from 'fs/promises';
import type { Project } from '../../shared/types';
import { parseAndClampProject, ParseResult } from './schema';

export async function saveProject(project: Project, filePath: string): Promise<void> {
  const json = JSON.stringify(project, null, 2);
  await fs.writeFile(filePath, json, 'utf8');
}

export async function loadProject(filePath: string): Promise<ParseResult> {
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  return parseAndClampProject(parsed);
}
