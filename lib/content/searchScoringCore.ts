import {
  computeSearchScores as computeSharedSearchScores,
  type BlogPost,
  type SearchScores,
} from '../blog/searchScoringEngine';

export type ContentSearchPost = BlogPost;
export type ContentSearchScores = SearchScores;

export function computeContentSearchScores(post: ContentSearchPost): ContentSearchScores {
  return computeSharedSearchScores(post);
}
