'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import tinify from 'tinify';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import * as Constant from './const';
import { createCdnUploader } from './CdnUploader/index';
import { guid } from './tools';

// Import ipc with try-catch
let ipc: any;
try {
    ipc = require('node-ipc');
    if (!ipc || !ipc.config) {
        console.error('node-ipc module loaded but ipc.config is undefined');
    }
} catch (error) {
    console.error('Failed to load node-ipc module:', error);
}

let configuration = vscode.workspace.getConfiguration('markdownPasteImage');
tinify.key = configuration.get('tinyPngKey') || ''; // the key is assigned to property _key
let cdnType = configuration.get<String>('cdnType') || '';
let ipcChannel: any;

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "markdown-image-paste" is now active!');

    initPlugin(true);

    // The command has been defined in the package.json file
    // Now provide the implementation of the command with  registerCommand
    // The commandId parameter must match the command field in package.json
    context.subscriptions.push(vscode.commands.registerCommand('extension.markdownPasteImage', async () => {
        // except of the first time the plugin is loaded, ipcChannel should be initialized.
        if (ipcChannel) {
            ipcChannel.emit(Constant.msg_getClipboardContent);
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('extension.markdownPasteImage.reInit', async () => {
        initPlugin(false);
    }));
}

// this method is called when your extension is deactivated
export function deactivate() {
    // disconnect ipc and kill the electron process
    ipc.disconnect(Constant.childIpcId);
}

function initPlugin(initInActivate: boolean) {
    // The code you place here will be executed every time your command is executed
    try {
        // Try to run eiis with nvm environment
        spawn('/bin/bash', ['-c', 'source ~/.nvm/nvm.sh && nvm use default && eiis']);
    } catch (error) {
        console.error('Error spawning eiis:', error);
    }

    // Check if ipc is properly loaded
    if (!ipc || !ipc.config) {
        console.error('IPC module not properly loaded');
        vscode.window.showErrorMessage('Failed to initialize IPC for image paste. Try reinstalling the node-ipc dependency.');
        return;
    }

    // connect to the ipc server started by electron process
    try {
        ipc.config.id = Constant.parentIpcId;
        ipc.config.retry = 1500;
        ipc.config.silent = true;

        ipc.connectTo(Constant.childIpcId, () => {
            // Make sure ipc.of[Constant.childIpcId] exists before assigning it
            ipcChannel = ipc.of && ipc.of[Constant.childIpcId] ? ipc.of[Constant.childIpcId] : null;
            
            if (!ipcChannel) {
                vscode.window.showWarningMessage('Failed to establish IPC connection for image paste');
                return;
            }
            
            ipcChannel.on('connect', () => {
                // the first time invoke this plugin, the icp is not connected,
                // ipcChannel is not initialized, so we trigger the message here.
                if (initInActivate) {
                    ipcChannel.emit(Constant.msg_getClipboardContent, '');
                }
            });

            ipcChannel.on(Constant.msg_resClipboardContent, (data: any) => {
                let buffer = new Buffer(data.data);

                if (!data || !data.data || !data.data.length) {
                    return vscode.window.showWarningMessage('Please copy a picture to clipboard for paste!');
                }

                if ((tinify as any)._key) {
                    // if tinify key is set, we leverage the tool to optimize the picture.
                    tinify.fromBuffer(buffer).toBuffer((err, data) => {
                        if (err) {
                            throw err;
                        }

                        if (data) {
                            buffer = new Buffer(data);
                        }
                    });
                    console.log('It\'s optimized!');
                }

                let currentFilePath = getCurrentFilePath();
                console.log(currentFilePath);
                // if the target file is a temporary file or md file, then try to upload asset to cdn
                if (currentFilePath.match(/^Untitled-.*|.*\.md$/)) {
                    let uploader = createCdnUploader(cdnType, configuration);
                    console.log(uploader);
                    if (uploader) {
                        uploader
                            .upload(buffer)
                            .then(url => {
                                insertImageToMd(url);
                            })
                            .catch(e => {
                                // cdn upload fail
                                vscode.window.showInformationMessage('upload to cdn fail');
                            });
                    } else {
                        // no cdn
                        copyAssetToCurrentFolder(buffer, currentFilePath);
                    }
                } else {
                    // target file is not md or temporary file.
                    copyAssetToCurrentFolder(buffer, currentFilePath);
                }
            });
        });
    } catch (error) {
        console.error('Error initializing IPC connection:', error);
        vscode.window.showErrorMessage('Failed to initialize IPC for image paste: ' + error);
    }
}

function insertImageToMd(url: String) {
    let editor = vscode.window.activeTextEditor;
    if (editor) {
        editor.edit((edit: any) => {
            let current = (editor as vscode.TextEditor).selection;
            if (current.isEmpty) {
                edit.insert(current.start, `![](${url})`);
            } else {
                edit.replace(current, `![](${url})`);
            }
        });
    }
}

function getCurrentFilePath() {
    let currentFilePath = (vscode.window.activeTextEditor &&
        vscode.window.activeTextEditor.document.fileName) || '';
    return currentFilePath;
}

// save the cilpbord to current folder as a fallback when cdn can not work.
function copyAssetToCurrentFolder(buffer: Buffer, currentFilePath: string, fileExtension: string = 'png') {
    if (!currentFilePath || (currentFilePath && currentFilePath.match(/^Untitled-.*/))) {
        vscode.window.showWarningMessage('The traget file is temporary, please save it to disk so that picture in clipboard can be copied to the folder of the file when cdn can not work!');
        return '';
    }

    let currentFolder = path.dirname(currentFilePath);

    vscode.window.showInformationMessage('save to current folder of the editing file');

    fs.writeFile(`${currentFolder}${path.sep}clipbord-${guid().slice(0, 5)}.${fileExtension}`, buffer, function (err: any) {
        if (err) {
            throw err;
        }
        console.log('It\'s saved!');
    });
}
