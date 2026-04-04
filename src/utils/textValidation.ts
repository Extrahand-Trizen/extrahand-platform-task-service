export interface MeaningfulTextValidationOptions {
  fieldName: string;
  minLength?: number;
  minWords?: number;
  allowSingleWord?: boolean;
  minSingleWordLength?: number;
  minSingleWordVowelRatio?: number;
  minVowelRatio?: number;
}

const COMMON_MEANINGFUL_WORDS = new Set([
  'clean', 'cleaning', 'deep', 'repair', 'fix', 'install', 'replace', 'service', 'help', 'need', 'required',
  'urgent', 'today', 'tomorrow', 'home', 'house', 'apartment', 'room', 'kitchen', 'bathroom', 'office',
  'plumber', 'plumbing', 'electrician', 'electrical', 'carpenter', 'painting', 'paint', 'garden', 'gardening',
  'delivery', 'pickup', 'assemble', 'assembly', 'furniture', 'sofa', 'bed', 'wardrobe', 'table', 'chair',
  'ac', 'air', 'conditioner', 'appliance', 'washing', 'machine', 'refrigerator', 'fridge', 'geyser',
  'pest', 'control', 'car', 'wash', 'laundry', 'ironing', 'driver', 'tutor', 'teacher', 'cook', 'chef',
  'pet', 'dog', 'cat', 'walking', 'security', 'camera', 'cctv', 'installation', 'moving', 'packers', 'movers',
  'website', 'mobile', 'app', 'design', 'develop', 'developer', 'photography', 'photo', 'video', 'event',
  'ghar', 'safai', 'kaam', 'kam', 'chahiye', 'karna', 'karni', 'pani', 'tank', 'bijli', 'plumber', 'mistri',
  'paint', 'driver', 'khana', 'banwana', 'madad', 'turant', 'aaj', 'kal', 'andar', 'bahar', 'naya', 'purana'
]);

const COMMON_BIGRAMS = new Set([
  'th', 'he', 'in', 'er', 'an', 're', 'on', 'at', 'en', 'nd', 'ti', 'es', 'or', 'te', 'of', 'ed', 'is',
  'it', 'al', 'ar', 'st', 'to', 'nt', 'ng', 'se', 'ha', 'as', 'ou', 'io', 'le', 've', 'co', 'me', 'de',
  'ra', 'ri', 'ro', 'la', 'li', 'na', 'ni', 'sa', 'ka', 'ki', 'ke', 'ai', 'ch', 'sh', 'bh', 'ph', 'dh'
]);

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function extractWords(text: string): string[] {
  return text.match(/[A-Za-z]+(?:'[A-Za-z]+)*/g) || [];
}

function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[^a-z]/g, '');
}

function getBigramScore(word: string): number {
  if (word.length < 2) return 0;
  let total = 0;
  let hits = 0;
  for (let i = 0; i < word.length - 1; i++) {
    const bg = word.slice(i, i + 2);
    total++;
    if (COMMON_BIGRAMS.has(bg)) hits++;
  }
  return total ? hits / total : 0;
}

function countLetters(text: string): number {
  return (text.match(/[A-Za-z]/g) || []).length;
}

function countVowels(text: string): number {
  return (text.match(/[aeiouy]/gi) || []).length;
}

function isLikelyMeaningfulWord(word: string): boolean {
  const normalized = normalizeWord(word);

  if (COMMON_MEANINGFUL_WORDS.has(normalized)) {
    return true;
  }

  if (normalized.length < 3) {
    return false;
  }

  const hasVowel = /[aeiouy]/.test(normalized);
  const hasConsonant = /[bcdfghjklmnpqrstvwxyz]/.test(normalized);
  if (!hasVowel || !hasConsonant) {
    return false;
  }

  // Blocks obvious junk tokens like aaabbb / dndffff / oeeeaa
  if (/(.)\1{2,}/.test(normalized)) {
    return false;
  }

  if (/[aeiouy]{4,}/.test(normalized) || /[bcdfghjklmnpqrstvwxyz]{5,}/.test(normalized)) {
    return false;
  }

  const uniqueChars = new Set(normalized.split(''));
  if (normalized.length >= 5 && uniqueChars.size <= 2) {
    return false;
  }

  const hasDictionarySignal = false;
  const bigramScore = getBigramScore(normalized);
  const hasShapeSignal = normalized.length >= 4 && bigramScore >= 0.34;

  if (!hasDictionarySignal && !hasShapeSignal) {
    return false;
  }

  return true;
}

export function getMeaningfulTextError(
  value: unknown,
  options: MeaningfulTextValidationOptions
): string | null {
  const text = normalizeText(value);
  const fieldName = options.fieldName;
  const minLength = options.minLength ?? 1;
  const minWords = options.minWords ?? 1;
  const minSingleWordLength = options.minSingleWordLength ?? 4;
  const minSingleWordVowelRatio = options.minSingleWordVowelRatio ?? 0.25;
  const minVowelRatio = options.minVowelRatio ?? 0.25;

  if (!text) {
    return `${fieldName} is required`;
  }

  if (text.length < minLength) {
    return `${fieldName} must be at least ${minLength} characters long`;
  }

  if (/^(.)\1{3,}$/i.test(text.replace(/\s+/g, ''))) {
    return `${fieldName} looks like repeated characters`;
  }

  const words = extractWords(text);
  if (words.length === 0) {
    return `${fieldName} must contain readable words`;
  }

  const meaningfulWords = words.filter(isLikelyMeaningfulWord);

  if (words.length === 1 && !options.allowSingleWord) {
    return `${fieldName} must contain at least ${minWords} descriptive words`;
  }

  if (words.length > 1 && words.length < minWords) {
    return `${fieldName} must contain at least ${minWords} descriptive words`;
  }

  if (words.length > 1) {
    const requiredMeaningfulWords = Math.max(2, minWords - 1);
    if (meaningfulWords.length < requiredMeaningfulWords) {
      return `${fieldName} should use clear, meaningful words`;
    }
  }

  const letters = countLetters(text);
  if (!letters) {
    return `${fieldName} must contain letters`;
  }

  const vowelRatio = countVowels(text) / letters;
  if (words.length === 1) {
    const [singleWord] = words;
    if (singleWord.length < minSingleWordLength) {
      return `${fieldName} must be more descriptive`;
    }

    if (!isLikelyMeaningfulWord(singleWord)) {
      return `${fieldName} should use clear, meaningful words`;
    }

    if (vowelRatio < minSingleWordVowelRatio) {
      return `${fieldName} must be more descriptive`;
    }
  } else if (vowelRatio < minVowelRatio) {
    return `${fieldName} must be more descriptive`;
  }

  const compactWords = words
    .map(word => word.toLowerCase())
    .filter(word => word.length >= 2);
  if (compactWords.length >= 3) {
    const uniqueWords = new Set(compactWords);
    if (uniqueWords.size === 1) {
      return `${fieldName} must not repeat the same word`;
    }
  }

  return null;
}

export function isMeaningfulText(
  value: unknown,
  options: MeaningfulTextValidationOptions
): boolean {
  return getMeaningfulTextError(value, options) === null;
}