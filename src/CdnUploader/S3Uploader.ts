import * as vscode from 'vscode';
import { guid } from '../tools';
import { S3Client, PutObjectCommand, ObjectCannedACL } from '@aws-sdk/client-s3';

export class S3Uploader implements CdnUploader {

    private preUrl: string;
    private bucket: string;
    private s3Client: S3Client;
    private isR2: boolean;

    constructor(config: vscode.WorkspaceConfiguration) {
        this.bucket = config.get('s3Bucket') || '';
        this.preUrl = config.get('s3PreUrl') || '';
        this.isR2 = config.get('cdnType') === 'r2';

        const accessKeyId: string = config.get('s3AccessKeyId') || '';
        const secretAccessKey: string = config.get('s3SecretAccessKey') || '';
        const region: string = config.get('s3Region') || (this.isR2 ? 'auto' : 'us-east-1');
        const endpoint: string | undefined = config.get('s3Endpoint') || undefined;

        // Create S3 client with configuration for either AWS S3 or Cloudflare R2
        this.s3Client = new S3Client({
            region: region,
            credentials: {
                accessKeyId: accessKeyId,
                secretAccessKey: secretAccessKey
            },
            endpoint: endpoint, // Custom endpoint is required for Cloudflare R2
        });
    }

    async upload(asset: Buffer): Promise<String> {
        if (!this.bucket || !this.preUrl) {
            vscode.window.showWarningMessage(`${this.isR2 ? 'R2' : 'S3'} configuration is not set correctly.`);
            return Promise.reject('Invalid configuration');
        }

        try {
            // Simple image type detection based on buffer header bytes
            let ext = 'png';
            let mime = 'image/png';
            
            // Check file signature bytes
            if (asset.length > 2) {
                // JPEG starts with FF D8 FF
                if (asset[0] === 0xFF && asset[1] === 0xD8 && asset[2] === 0xFF) {
                    ext = 'jpg';
                    mime = 'image/jpeg';
                }
                // PNG starts with 89 50 4E 47
                else if (asset[0] === 0x89 && asset[1] === 0x50 && asset[2] === 0x4E && asset[3] === 0x47) {
                    ext = 'png';
                    mime = 'image/png';
                }
                // GIF starts with GIF87a or GIF89a
                else if (asset[0] === 0x47 && asset[1] === 0x49 && asset[2] === 0x46) {
                    ext = 'gif';
                    mime = 'image/gif';
                }
            }
            
            const ft = { ext, mime };
            const key = guid() + "." + ft.ext;

            // Configure the upload parameters
            const params = {
                Bucket: this.bucket,
                Key: key,
                ContentType: ft.mime,
                Body: asset,
                ACL: ObjectCannedACL.public_read
            };

            // Upload to S3 or R2
            const command = new PutObjectCommand(params);
            const response = await this.s3Client.send(command);
            
            console.log(this.isR2 ? 'R2 upload successful:' : 'S3 upload successful:', response);
            
            // Return the URL of the uploaded file
            return `${this.preUrl.endsWith('/') ? this.preUrl + key : this.preUrl + '/' + key}`;
        } catch (error) {
            console.error('Error uploading to ' + (this.isR2 ? 'R2' : 'S3') + ':', error);
            return Promise.reject(error);
        }
    }
}