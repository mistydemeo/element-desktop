/*
Copyright 2020 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

const path = require('path');
const child_process = require('child_process');

const mkdirp = require('mkdirp');
const fsExtra = require('fs-extra');

module.exports = async function(hakEnv, moduleInfo) {
    if (hakEnv.isWin()) {
        await buildOpenSslWin(hakEnv, moduleInfo);
        await buildSqlCipherWin(hakEnv, moduleInfo);
    } else {
        await buildSqlCipherUnix(hakEnv, moduleInfo);
    }
    await buildMatrixSeshat(hakEnv, moduleInfo);
}

async function buildOpenSslWin(hakEnv, moduleInfo) {
    const openSslDir = path.join(moduleInfo.moduleDotHakDir, 'openssl-1.1.1d');

    const openSslArch = hakEnv.arch === 'x64' ? 'VC-WIN64A' : 'VC-WIN32';

    console.log("Building openssl in " + openSslDir);
    await new Promise((resolve, reject) => {
        const proc = child_process.spawn(
            'perl',
            [
                'Configure',
                '--prefix=' + moduleInfo.depPrefix,
                 // sqlcipher only uses about a tiny part of openssl. We link statically
                 // so will only pull in the symbols we use, but we may as well turn off
                 // as much as possible to save on build time.
                'no-afalgeng',
                'no-capieng',
                'no-cms',
                'no-ct',
                'no-deprecated',
                'no-dgram',
                'no-dso',
                'no-ec',
                'no-ec2m',
                'no-gost',
                'no-nextprotoneg',
                'no-ocsp',
                'no-sock',
                'no-srp',
                'no-srtp',
                'no-tests',
                'no-ssl',
                'no-tls',
                'no-dtls',
                'no-shared',
                'no-aria',
                'no-camellia',
                'no-cast',
                'no-chacha',
                'no-cmac',
                'no-des',
                'no-dh',
                'no-dsa',
                'no-ecdh',
                'no-ecdsa',
                'no-idea',
                'no-md4',
                'no-mdc2',
                'no-ocb',
                'no-poly1305',
                'no-rc2',
                'no-rc4',
                'no-rmd160',
                'no-scrypt',
                'no-seed',
                'no-siphash',
                'no-sm2',
                'no-sm3',
                'no-sm4',
                'no-whirlpool',
                openSslArch,
            ],
            {
                cwd: openSslDir,
                stdio: 'inherit',
            },
        );
        proc.on('exit', (code) => {
            code ? reject(code) : resolve();
        });
    });

    await new Promise((resolve, reject) => {
        const proc = child_process.spawn(
            'nmake',
            ['build_libs'],
            {
                cwd: openSslDir,
                stdio: 'inherit',
            },
        );
        proc.on('exit', (code) => {
            code ? reject(code) : resolve();
        });
    });

    await new Promise((resolve, reject) => {
        const proc = child_process.spawn(
            'nmake',
            ['install_dev'],
            {
                cwd: openSslDir,
                stdio: 'inherit',
            },
        );
        proc.on('exit', (code) => {
            code ? reject(code) : resolve();
        });
    });
}

async function buildSqlCipherWin(hakEnv, moduleInfo) {
    const sqlCipherDir = path.join(moduleInfo.moduleDotHakDir, 'sqlcipher-4.3.0');
    const buildDir = path.join(sqlCipherDir, 'bld');

    await mkdirp(buildDir);

    await new Promise((resolve, reject) => {
        const proc = child_process.spawn(
            'nmake',
            ['/f', path.join('..', 'Makefile.msc'), 'libsqlite3.lib', 'TOP=..'],
            {
                cwd: buildDir,
                stdio: 'inherit',
	        env: Object.assign({}, process.env, {
                    CCOPTS: "-DSQLITE_HAS_CODEC -I" + path.join(moduleInfo.depPrefix, 'include'),
                    LTLIBPATHS: "/LIBPATH:" + path.join(moduleInfo.depPrefix, 'lib'),
                    LTLIBS: "libcrypto.lib",
                }),
            },
        );
        proc.on('exit', (code) => {
            code ? reject(code) : resolve();
        });
    });

    await fsExtra.copy(
        path.join(buildDir, 'libsqlite3.lib'),
        path.join(moduleInfo.depPrefix, 'lib', 'sqlcipher.lib'),
    );

    await fsExtra.copy(
        path.join(buildDir, 'sqlite3.h'),
        path.join(moduleInfo.depPrefix, 'include', 'sqlcipher.h'),
    );
}

async function buildSqlCipherUnix(hakEnv, moduleInfo) {
    const sqlCipherDir = path.join(moduleInfo.moduleDotHakDir, 'sqlcipher-4.3.0');

    const args = [
        '--prefix=' + moduleInfo.depPrefix + '',
        '--enable-tempstore=yes',
        '--enable-shared=no',
    ];

    if (hakEnv.isMac()) {
        args.push('--with-crypto-lib=commoncrypto');
    }
    args.push('CFLAGS=-DSQLITE_HAS_CODEC');
    if (hakEnv.isMac()) {
        args.push('LDFLAGS=-framework Security -framework Foundation');
    }

    await new Promise((resolve, reject) => {
        const proc = child_process.spawn(
            path.join(sqlCipherDir, 'configure'),
            args,
            {
                cwd: sqlCipherDir,
                stdio: 'inherit',
            },
        );
        proc.on('exit', (code) => {
            code ? reject(code) : resolve();
        });
    });

    await new Promise((resolve, reject) => {
        const proc = child_process.spawn(
            'make',
            [],
            {
                cwd: sqlCipherDir,
                stdio: 'inherit',
            },
        );
        proc.on('exit', (code) => {
            code ? reject(code) : resolve();
        });
    });

    await new Promise((resolve, reject) => {
        const proc = child_process.spawn(
            'make',
            ['install'],
            {
                cwd: sqlCipherDir,
                stdio: 'inherit',
            },
        );
        proc.on('exit', (code) => {
            code ? reject(code) : resolve();
        });
    });
}

async function buildMatrixSeshat(hakEnv, moduleInfo) {
    const env = Object.assign({
        SQLCIPHER_STATIC: 1,
        SQLCIPHER_LIB_DIR: path.join(moduleInfo.depPrefix, 'lib'),
        SQLCIPHER_INCLUDE_DIR: path.join(moduleInfo.depPrefix, 'include'),
    }, hakEnv.makeGypEnv());

    if (hakEnv.isWin()) {
        env.RUSTFLAGS = '-Ctarget-feature=+crt-static -Clink-args=libcrypto.lib';
    }

    console.log("Running neon with env", env);
    await new Promise((resolve, reject) => {
        const proc = child_process.spawn(
            path.join(moduleInfo.nodeModuleBinDir, 'neon' + (hakEnv.isWin() ? '.cmd' : '')),
            ['build', '--release'],
            {
                cwd: moduleInfo.moduleBuildDir,
                env,
                stdio: 'inherit',
            },
        );
        proc.on('exit', (code) => {
            code ? reject(code) : resolve();
        });
    });
}
