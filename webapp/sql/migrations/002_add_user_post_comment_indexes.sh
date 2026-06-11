add_index_if_missing "posts" "posts_user_id_created_at_idx" "
ALTER TABLE posts
  ADD INDEX posts_user_id_created_at_idx (user_id, created_at DESC);
"

add_index_if_missing "comments" "comments_user_id_idx" "
ALTER TABLE comments
  ADD INDEX comments_user_id_idx (user_id);
"
