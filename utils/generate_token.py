from livekit import api
token = api.AccessToken(
    api_key="APIuo7ZXggAeaEa",
    api_secret="DftNsfYjgFSxder8W1DIRfSwK5g8gPQcUXf2eNQgc8dB"
).with_identity("trupti").with_name("trupti").with_grants(
    api.VideoGrants(
        room_join=True,
        room="demo-room",
    )
)
print(token.to_jwt())