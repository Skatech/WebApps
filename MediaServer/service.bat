@echo off
set SVC_NAME="Mediaserver"
set SVC_DESC="Media server web service"
set SVC_FILE="%cd%\launch.js"

if /i "%1" equ "-i" (
	echo Installing service:
	node ../ServiceLauncher/qckwinsvc.js --name %SVC_NAME% --description %SVC_DESC% --script %SVC_FILE% --startImmediately

) else if /i "%1" equ "-u" (
	echo Uninstalling service:
	node ../ServiceLauncher/qckwinsvc.js --uninstall --name %SVC_NAME% --script %SVC_FILE%

) else (

	echo %SVC_DESC:"=% utility
	echo   -i  - install and start service
	echo   -u  - uninstall service
)
