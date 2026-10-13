const fs = require("fs");
const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");

module.exports = (env, argv) => {
  const isProd = argv.mode === "production";
  const outputPath = path.resolve(__dirname, "dist");
  const styleLoader = isProd ? MiniCssExtractPlugin.loader : "style-loader";

  const appConfig = {
    name: "app",
    mode: isProd ? "production" : "development",
    entry: "./src/index.jsx",
    output: {
      path: outputPath,
      filename: isProd ? "js/[name].[contenthash].js" : "js/[name].js",
      publicPath: "/",
      clean: true,
    },
    devtool: isProd ? false : "source-map",
    resolve: {
      extensions: [".js", ".jsx"],
    },
    module: {
      rules: [
        {
          test: /\.jsx?$/,
          exclude: /node_modules/,
          use: {
            loader: "babel-loader",
            options: {
              presets: [
                ["@babel/preset-env", { targets: "defaults" }],
                ["@babel/preset-react", { runtime: "automatic" }],
              ],
            },
          },
        },
        {
          test: /\.module\.scss$/,
          use: [
            styleLoader,
            {
              loader: "css-loader",
              options: {
                modules: {
                  namedExport: false,
                  localIdentName: isProd ? "[hash:base64:8]" : "[name]__[local]",
                },
              },
            },
            "sass-loader",
          ],
        },
        {
          test: /\.scss$/,
          exclude: /\.module\.scss$/,
          use: [styleLoader, "css-loader", "sass-loader"],
        },
      ],
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: "./src/index.html",
      }),
      ...(isProd
        ? [new MiniCssExtractPlugin({ filename: "css/[name].[contenthash].css" })]
        : []),
      new CopyWebpackPlugin({
        patterns: [{ from: "public", to: "." }],
      }),
    ],
    devServer: {
      // IPv4 explicitly: "localhost" on this machine binds only ::1, and that socket refuses connections.
      host: "127.0.0.1",
      port: 8080,
      historyApiFallback: true,
      hot: true,
      static: {
        directory: path.resolve(__dirname, "public"),
      },
      proxy: [
        {
          context: ["/api"],
          target: "http://127.0.0.1:3000",
          ws: true,
        },
      ],
      setupMiddlewares: (middlewares) => {
        middlewares.unshift((req, res, next) => {
          const url = req.url || "";
          if (url !== "/sw.js" && !url.startsWith("/sw.js?")) {
            next();
            return;
          }
          const file = path.join(outputPath, "sw.js");
          if (!fs.existsSync(file)) {
            next();
            return;
          }
          res.setHeader("Content-Type", "application/javascript; charset=utf-8");
          fs.createReadStream(file).pipe(res);
        });
        return middlewares;
      },
    },
  };

  const swConfig = {
    name: "sw",
    dependencies: ["app"],
    mode: isProd ? "production" : "development",
    target: "webworker",
    entry: "./src/sw.js",
    output: {
      path: outputPath,
      filename: "sw.js",
      publicPath: "/",
      clean: false,
    },
    devtool: false,
    devServer: false,
  };

  return [appConfig, swConfig];
};
