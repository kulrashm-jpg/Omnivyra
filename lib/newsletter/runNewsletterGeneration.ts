import {
  runSharedGeneration,
  type SharedGenerationRequest,
  type SharedGenerationResult,
} from '../content/sharedGenerationRunner';
import { runInsightLetterGeneration } from './runInsightLetterGeneration';
import { runSplitScreenInsightGeneration } from './runSplitScreenInsightGeneration';
import { runWeeklyRadarGeneration } from './runWeeklyRadarGeneration';
import { runWeeklyBoardGeneration } from './runWeeklyBoardGeneration';
import { runMarketMapGeneration } from './runMarketMapGeneration';
import { runStrategyMemoGeneration } from './runStrategyMemoGeneration';
import { runOperatorPlaybookGeneration } from './runOperatorPlaybookGeneration';
import { runSprintSheetGeneration } from './runSprintSheetGeneration';

export type NewsletterGenerationRequest =
  Omit<SharedGenerationRequest, 'contentType'> & {
    contentType?: 'newsletter';
  };

export type NewsletterGenerationResult = SharedGenerationResult;

function isMinimalThesisRequest(input: NewsletterGenerationRequest): boolean {
  return typeof input.template_name === 'string' && input.template_name.trim().toLowerCase() === 'minimal thesis';
}

function isSignalRadarRequest(input: NewsletterGenerationRequest): boolean {
  return typeof input.template_name === 'string' && input.template_name.trim().toLowerCase() === 'signal radar';
}

function isAnalystBoardRequest(input: NewsletterGenerationRequest): boolean {
  return typeof input.template_name === 'string' && input.template_name.trim().toLowerCase() === 'analyst board';
}

function isSplitScreenInsightRequest(input: NewsletterGenerationRequest): boolean {
  return typeof input.template_name === 'string' && input.template_name.trim().toLowerCase() === 'split-screen insight';
}

function isMarketMapRequest(input: NewsletterGenerationRequest): boolean {
  return typeof input.template_name === 'string' && input.template_name.trim().toLowerCase() === 'market map';
}

function isStrategyMemoRequest(input: NewsletterGenerationRequest): boolean {
  return typeof input.template_name === 'string' && input.template_name.trim().toLowerCase() === 'strategy memo';
}

function isOperatorPlaybookRequest(input: NewsletterGenerationRequest): boolean {
  return typeof input.template_name === 'string' && input.template_name.trim().toLowerCase() === 'operator playbook';
}

function isSprintSheetRequest(input: NewsletterGenerationRequest): boolean {
  return typeof input.template_name === 'string' && input.template_name.trim().toLowerCase() === 'sprint sheet';
}

export async function runNewsletterGeneration(
  input: NewsletterGenerationRequest,
): Promise<NewsletterGenerationResult> {
  if (isMinimalThesisRequest(input)) {
    return runInsightLetterGeneration(input);
  }
  if (isSplitScreenInsightRequest(input)) {
    return runSplitScreenInsightGeneration(input);
  }
  if (isSignalRadarRequest(input)) {
    return runWeeklyRadarGeneration(input);
  }
  if (isAnalystBoardRequest(input)) {
    return runWeeklyBoardGeneration(input);
  }
  if (isStrategyMemoRequest(input)) {
    return runStrategyMemoGeneration(input);
  }
  if (isMarketMapRequest(input)) {
    return runMarketMapGeneration(input);
  }
  if (isOperatorPlaybookRequest(input)) {
    return runOperatorPlaybookGeneration(input);
  }
  if (isSprintSheetRequest(input)) {
    return runSprintSheetGeneration(input);
  }

  return runSharedGeneration({
    ...input,
    contentType: 'newsletter',
  });
}
