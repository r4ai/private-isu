add_index_if_missing "comments" "comments_post_id_created_at_idx" "
ALTER TABLE comments
  ADD INDEX comments_post_id_created_at_idx (post_id, created_at DESC);
"
