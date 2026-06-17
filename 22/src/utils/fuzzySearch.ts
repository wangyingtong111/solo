import { Cluster } from '../types';

const levenshteinDistance = (a: string, b: string): number => {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
};

export const fuzzySearchClusters = (
  clusters: Cluster[],
  query: string,
  maxResults: number = 5
): Cluster[] => {
  if (!query.trim()) return [];

  const lowerQuery = query.toLowerCase();

  const scored = clusters.map(cluster => {
    const lowerName = cluster.name.toLowerCase();
    let score = 0;

    if (lowerName.includes(lowerQuery)) {
      score = 100 - lowerName.indexOf(lowerQuery);
    }

    if (lowerName.startsWith(lowerQuery)) {
      score += 50;
    }

    const distance = levenshteinDistance(lowerQuery, lowerName);
    const maxLen = Math.max(lowerQuery.length, lowerName.length);
    const similarity = 1 - distance / maxLen;
    score += similarity * 30;

    const queryChars = lowerQuery.split('');
    let nameIdx = 0;
    let matchCount = 0;
    for (const char of queryChars) {
      while (nameIdx < lowerName.length && lowerName[nameIdx] !== char) {
        nameIdx++;
      }
      if (nameIdx < lowerName.length) {
        matchCount++;
        nameIdx++;
      }
    }
    if (matchCount === queryChars.length) {
      score += 20;
    }

    return { cluster, score };
  });

  return scored
    .filter(s => s.score > 10)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(s => s.cluster);
};

export const highlightMatch = (text: string, query: string): string => {
  if (!query.trim()) return text;

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);

  if (index === -1) return text;

  return (
    text.slice(0, index) +
    '<mark class="search-highlight">' +
    text.slice(index, index + query.length) +
    '</mark>' +
    text.slice(index + query.length)
  );
};
