
import * as vscode from "vscode";
import { IProfile } from "../model/target/target";
import { HttpService } from "./http.service";
import MarkdownIt = require("markdown-it");
import { WebviewService } from "./webview.service";
import { join } from "path";
import { TemplatePath } from "../const/PATH";
import { AnswerAPI, QuestionAPI } from "../const/URL";
import { unescapeMd, escapeHtml } from "../util/md-html-utils";
import { CollectionService, ICollectionItem } from "./collection.service";
import { MediaTypes } from "../const/ENUM";
import { PostAnswer } from "../model/publish/answer.model";


export class PublishService {
	public profile: IProfile;

	constructor (protected context: vscode.ExtensionContext, 
		protected httpService: HttpService,
		protected zhihuMdParser: MarkdownIt,
		protected defualtMdParser: MarkdownIt,
		protected webviewService: WebviewService,
		protected collectionService: CollectionService
		) {
			zhihuMdParser.renderer.rules.fence = function (tokens, idx, options, env, self) {
				var token = tokens[idx],
					info = token.info ? unescapeMd(token.info).trim() : '',
					langName = '',
					highlighted, i, tmpAttrs, tmpToken;
			
				if (info) {
					langName = info.split(/\s+/g)[0];
				}
			
				if (options.highlight) {
					highlighted = options.highlight(token.content, langName) || escapeHtml(token.content);
				} else {
					highlighted = escapeHtml(token.content);
				}
			
				if (highlighted.indexOf('<pre') === 0) {
					return highlighted + '\n';
				}
			
				// If language exists, inject class gently, without modifying original token.
				// May be, one day we will add .clone() for token and simplify this part, but
				// now we prefer to keep things local.
				if (info) {
					i = token.attrIndex('lang');
					tmpAttrs = token.attrs ? token.attrs.slice() : [];
			
					if (i < 0) {
						tmpAttrs.push(['lang', langName]);
					} else {
						tmpAttrs[i][1] += ' ' + langName;
					}
			
					// Fake token just to render attributes
					tmpToken = {
						attrs: tmpAttrs
					};
			
					return '<pre' + zhihuMdParser.renderer.renderAttrs(tmpToken) + '>'
						+ highlighted
						+ '</pre>\n';
				}
			
			
				return '<pre' + zhihuMdParser.renderer.renderAttrs(token) + '>'
					+ highlighted
					+ '</pre>\n';
			};
	}

	preview(textEdtior: vscode.TextEditor, edit: vscode.TextEditorEdit) {
		let text = textEdtior.document.getText();
		let html = this.defualtMdParser.render(text);
		this.webviewService.renderHtml({
			title: '预览',
			pugTemplatePath: join(this.context.extensionPath, TemplatePath, 'pre-publish.pug'),
			pugObjects: {
				title: '答案预览',
				content: html
			},
			showOptions: {
				viewColumn: vscode.ViewColumn.Beside,
				preserveFocus: true
			}
		});
	}

	async publish(textEdtior: vscode.TextEditor, edit: vscode.TextEditorEdit) {
		let text = textEdtior.document.getText();
		let html = this.zhihuMdParser.render(text);
		const selectedTarget: ICollectionItem = await vscode.window.showQuickPick<vscode.QuickPickItem & ICollectionItem> (
			this.collectionService.getTargets().then(
				(targets) => {
					let items = targets.map(t => ({ label: t.title ? t.title : t.excerpt, description: t.excerpt, id: t.id, type: t.type }));
					return items;
				}
			)
		).then(item => ({ id: item.id, type: item.type}) );
		html.replace('\"', '\\\"');
		if (selectedTarget.type == MediaTypes.question) {
			this.httpService.sendRequest({
				uri: `${QuestionAPI}/${selectedTarget.id}/answers`,
				method: 'post',
				body: new PostAnswer(html),
				json: true,
				resolveWithFullResponse: true,
				headers: {}
			}).then(resp => {
				if (resp.statusCode == 200) {
					vscode.window.showInformationMessage(`发布成功！\n ${QuestionAPI}/${selectedTarget.id}/answers/${resp.body.id}`)
					const pane = vscode.window.createWebviewPanel('zhihu', 'zhihu', vscode.ViewColumn.One, { enableScripts: true, enableCommandUris: true, enableFindWidget: true });
					this.httpService.sendRequest({ uri: `${AnswerAPI}/${selectedTarget.id}`, gzip: true } ).then(
						resp => {
							pane.webview.html = resp
						}
					);					
				}
			})
		} else if (selectedTarget.type == MediaTypes.answer) {
			this.httpService.sendRequest({
				uri: `${AnswerAPI}/${selectedTarget.id}`,
				method: 'put',
				body: {
					content: html,
					reward_setting: {"can_reward":false,"tagline":""},
				},
				json: true,
				resolveWithFullResponse: true,
				headers: {},
			}).then(resp => { 
				vscode.window.showInformationMessage(`发布成功！\n ${AnswerAPI}/${selectedTarget.id}`)
				const pane = vscode.window.createWebviewPanel('zhihu', 'zhihu', vscode.ViewColumn.One, { enableScripts: true, enableCommandUris: true, enableFindWidget: true });
				this.httpService.sendRequest({ uri: `${AnswerAPI}/${selectedTarget.id}`, gzip: true } ).then(
					resp => {
						pane.webview.html = resp
					}
				);
			})
	
		}
	}
}