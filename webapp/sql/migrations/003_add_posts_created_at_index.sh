add_index_if_missing "posts" "posts_created_at_idx" "
ALTER TABLE posts
  ADD INDEX posts_created_at_idx (created_at DESC);
"
