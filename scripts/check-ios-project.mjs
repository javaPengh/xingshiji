// Structural checks usable on Windows. Xcode compilation and device tests are separate.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {APP_VERSION} from '../shared/version.mjs';

const root=path.resolve(import.meta.dirname,'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');
const project=read('ios/App/App.xcodeproj/project.pbxproj');
const scene=read('ios/App/App/SceneDelegate.swift');
const plugin=read('ios/App/App/OfflineStoragePlugin.swift');
const plist=read('ios/App/App/Info.plist');
assert.match(scene,/rootViewController\s*=\s*LocalBridgeViewController\(\)/,'Scene must register native storage');
assert.match(plugin,/class LocalBridgeViewController: CAPBridgeViewController/);
assert.match(plugin,/registerPluginInstance\(OfflineStoragePlugin\(\)\)/);
assert.match(project,/OfflineStoragePlugin\.swift in Sources/);
assert.match(project,/SceneDelegate\.swift in Sources/);
assert.match(read('ios/App/App/Base.lproj/Main.storyboard'),/customClass="LocalBridgeViewController"/);
for(const file of ['AppDelegate.swift','SceneDelegate.swift','OfflineStoragePlugin.swift','Info.plist','PrivacyInfo.xcprivacy','config.xml','capacitor.config.json'])assert.ok(fs.existsSync(path.join(root,'ios/App/App',file)),file+' missing');
for(const permission of ['NSCameraUsageDescription','NSPhotoLibraryUsageDescription','NSPhotoLibraryAddUsageDescription','NSMotionUsageDescription'])assert.ok(plist.includes('<key>'+permission+'</key>'),permission+' missing');
assert.ok(!plist.includes('NSAllowsArbitraryLoads'),'Trusted HTTPS must remain enabled');
assert.ok(project.includes('MARKETING_VERSION = '+APP_VERSION+';'),'Native and client versions differ');
const native=JSON.parse(read('ios/App/App/capacitor.config.json'));
assert.equal(native.appId,'local.xiaoka.diary');
assert.equal(native.appName,'行食记');
assert.match(plist,/<key>CFBundleDisplayName<\/key>\s*<string>行食记<\/string>/);
assert.equal(native.server?.url,undefined,'The IPA must bundle its client, not load a remote webpage');
const spm=read('ios/App/CapApp-SPM/Package.swift');
for(const name of ['camera','filesystem','share']){
 const packageDirectory=path.join(root,'node_modules/@capacitor',name);
 assert.ok(fs.existsSync(path.join(packageDirectory,'Package.swift')),'Missing Swift package '+name);
 assert.ok(spm.includes('../../../node_modules/@capacitor/'+name),'Invalid package path '+name);
}
const web=path.join(root,'ios/App/App/public');
for(const file of ['index.html','sw.js'])assert.ok(fs.existsSync(path.join(web,file)),'Missing native web asset '+file);

assert.match(plugin,/registerPluginInstance\(PedometerPlugin\(\)\)/);
assert.match(project,/PedometerPlugin\.swift in Sources/);
assert.match(read('ios/App/App/PedometerPlugin.swift'),/import CoreMotion/);
assert.match(read('ios/App/App/PedometerPlugin.swift'),/queryPedometerData/);
assert.match(read('ios/App/App/PedometerPlugin.swift'),/startUpdates/);
assert.match(read('ios/App/App/PedometerPlugin.swift'),/stopUpdates/);
assert.match(read('ios/App/App/PedometerPlugin.swift'),/UIApplication.openSettingsURLString/);

console.log(JSON.stringify({passed:true,kind:'ios_project_structure_only',version:APP_VERSION,nativeEntry:'LocalBridgeViewController',storage:'SQLite_and_Keychain_bridge_registered',pedometer:'CoreMotion_bridge_registered',compiledWithXcode:false,deviceTested:false}));
