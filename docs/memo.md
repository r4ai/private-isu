# private-isu memo

WSL + Docker Compose 前提。

## 起動

```sh
cd webapp
docker compose up -d
```

ブラウザ:

```text
http://localhost/
```

## よく使う

状態確認:

```sh
docker ps
```

アプリログ:

```sh
cd webapp
docker compose logs -f app
```

MySQL接続:

```sh
cd webapp
docker compose exec mysql mysql -uroot -proot isuconp
```

アプリ再起動:

```sh
cd webapp
docker compose restart app
```

## DB スキーマ反映

```
./scripts/rebuild_dump_from_userdata.sh
CONFIRM_RESET_DB_VOLUME=1 ./scripts/recreate_webapp_db.sh
```

既存 DB に migration だけ反映:

```sh
./scripts/apply_migrations.sh
```

`webapp/sql/migrations/*.sh` が順番に実行される。
`recreate_webapp_db.sh` は DB 再作成後に migration も自動適用する。

## 変更を反映

```sh
cd webapp
docker compose up -d --build
```

## ベンチ

DB計測のリセット：

```sh
./scripts/reset_mysql_digest.sh
```

ベンチの実行：

```sh
./scripts/bench_log.sh
```

DB計測：

```sh
./scripts/mysql_digest.sh
```

結果は `docs/bench_results.csv` に追記される。

## 初期データがないとき

```sh
make init
```
