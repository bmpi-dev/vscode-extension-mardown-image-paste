import * as vscode from 'vscode';
var cloudinary = require('cloudinary');

export class CloudinaryUploader implements CdnUploader {
  folder: string;

  constructor(config: vscode.WorkspaceConfiguration) {
    let cloudName = config.get('cloudinaryName') || '';
    let key = config.get('cloudinaryApiKey') || '';
    let secret = config.get('cloudinarySecret') || '';
    this.folder = config.get('cloudinaryFolder') || '';

    cloudinary.config({
      cloud_name: cloudName,
      api_key: key,
      api_secret: secret
    });
  }

  upload(asset: Buffer): Promise<String> {
    return new Promise((resolve, reject) => {
      let content = asset.toString('base64');

      try {
        cloudinary.v2.uploader.upload(`data:image/png;base64,${content}`, {
          folder: this.folder,
          fetch_format: 'auto',
          quality: 'auto'
        }, (error: any, result: any) => {
          if (error) {
            vscode.window.showWarningMessage(error.message);
            reject(error);
          } else {
            console.log(result);
            resolve(result.secure_url);
          }
        });
      } catch (e) {
        vscode.window.showWarningMessage(typeof e === 'string' ? e : String(e));
      }
    });
  }
}
