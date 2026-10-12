from datetime import timedelta

import boto3
from botocore.client import Config

from app.core.config import Settings
from app.core.security import utcnow


class S3Storage:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.client = boto3.client(
            "s3",
            endpoint_url=settings.storage_endpoint,
            aws_access_key_id=settings.storage_access_key,
            aws_secret_access_key=settings.storage_secret_key,
            config=Config(signature_version="s3v4"),
        )

    def presigned_get(self, object_key: str, file_name: str, download: bool) -> tuple[str, str]:
        expires_seconds = self.settings.storage_presigned_ttl_seconds
        disposition = "attachment" if download else "inline"
        url = self.client.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": self.settings.storage_bucket,
                "Key": object_key,
                "ResponseContentDisposition": f'{disposition}; filename="{file_name}"',
            },
            ExpiresIn=expires_seconds,
        )
        return url, (utcnow() + timedelta(seconds=expires_seconds)).isoformat().replace("+00:00", "Z")

    def upload(self, object_key: str, content: bytes, media_type: str) -> None:
        self.client.put_object(
            Bucket=self.settings.storage_bucket, Key=object_key, Body=content, ContentType=media_type
        )

    def read(self, object_key: str) -> bytes:
        response = self.client.get_object(Bucket=self.settings.storage_bucket, Key=object_key)
        return response["Body"].read()
