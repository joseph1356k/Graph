const REVIEW_NOTICE = 'Sugerencias de IA para revisión médica. No constituyen diagnósticos confirmados.';

function normalizeComparableText(value = '') {
  return `${value || ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

class ClinicalDiagnosisSuggestionService {
  constructor(llmProvider = null) {
    this.llmProvider = llmProvider;
  }

  hasLlm() {
    return Boolean(this.llmProvider?.hasApiKey?.());
  }

  buildMessages(noteContent = '') {
    return [
      {
        role: 'system',
        content: [
          'You are Miracle Clinical Differential Assistant.',
          'Generate possible differential diagnosis suggestions for physician review from the supplied clinical note only.',
          'These are suggestions, never confirmed diagnoses.',
          'Return JSON only with schema:',
          '{"suggestions":[{"title":"string","rationale":"string","supportingEvidence":"exact quote from note"}]}',
          'Rules:',
          '- Return at most 5 suggestions, ordered from most to least supported.',
          '- Use only facts explicitly present in the note. Do not invent symptoms, history, test results, demographics, medications, or risk factors.',
          '- supportingEvidence must be a short verbatim quote from the note that supports the suggestion.',
          '- Keep rationale concise and explain uncertainty.',
          '- Do not provide treatment, prescriptions, dosage, or instructions.',
          '- If the note does not support a responsible differential, return {"suggestions":[]}.',
          '- Do not include text outside the JSON object.'
        ].join(' ')
      },
      {
        role: 'user',
        content: JSON.stringify({ noteContent: `${noteContent || ''}` })
      }
    ];
  }

  normalizeResult(parsed = {}, noteContent = '') {
    const normalizedNote = normalizeComparableText(noteContent);
    const suggestions = (Array.isArray(parsed?.suggestions) ? parsed.suggestions : [])
      .slice(0, 5)
      .map((suggestion) => ({
        title: `${suggestion?.title || ''}`.trim().slice(0, 160),
        rationale: `${suggestion?.rationale || ''}`.trim().slice(0, 600),
        supportingEvidence: `${suggestion?.supportingEvidence || ''}`.trim().slice(0, 240)
      }))
      .filter((suggestion) => {
        if (!suggestion.title || !suggestion.rationale || !suggestion.supportingEvidence) {
          return false;
        }
        return normalizedNote.includes(normalizeComparableText(suggestion.supportingEvidence));
      });

    return {
      suggestions,
      reviewNotice: REVIEW_NOTICE
    };
  }

  async suggest(noteContent = '') {
    if (!this.hasLlm()) {
      const error = new Error('No LLM API key is configured');
      error.code = 'LLM_NOT_CONFIGURED';
      throw error;
    }

    const content = await this.llmProvider.chatExpectingJson(
      this.buildMessages(noteContent),
      { type: 'json_object' }
    );
    const parsed = this.llmProvider.parseJsonObject(content || '{}');
    return this.normalizeResult(parsed, noteContent);
  }
}

ClinicalDiagnosisSuggestionService.REVIEW_NOTICE = REVIEW_NOTICE;

module.exports = ClinicalDiagnosisSuggestionService;
