module.exports = [
	{
		rules: {
			"no-constant-binary-expression": "error",
			indent: [ "warn", "tab", { SwitchCase: 0 } ],
			semi: [ "error", "never" ],
			"no-unused-vars": [ "error", { vars: "all", args: "all", argsIgnorePattern: "^_" } ],
		},
	},
]
