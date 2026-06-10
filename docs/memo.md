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

## 変更を反映

```sh
cd webapp
docker compose up -d --build
```

## ベンチ

```sh
./docs/bench_log.sh
```

結果は `docs/bench_results.csv` に追記される。

## 初期データがないとき

```sh
make init
```
