# Micro:bit Maqueen MicroPython

The extension was created for computer science lessons and should make it easier to programme the Maqueen Plus V2.0 in Python (Micropython). The [micropython-microbit-stubs](https://github.com/microbit-foundation/micropython-microbit-stubs) are used for a pleasant programming experience. These files are copied from the extension to the project folder.

## Disclaimer
The extension has not yet been tested in the classroom. It can be assumed that not everything is working well yet.

## Dependencies
The extension can be used without additional installations. In particular, no Python interpreter needs to be installed.

However, it is strongly recommended to install the [Python](https://marketplace.visualstudio.com/items?itemName=ms-python.python) extension (IntelliSence, formatting, ...).

## Start Maqueen project

Click on the extension icon in the activity bar. If no folder with a Maqueen project is open, a welcome view appears, which allows you to start a new project or continue working on an existing one.

### No folder ist open
![Welcome View](https://dev.lernbaum.ch/img/maqueen/welcome1.png)

### A folder without a complete Micro:bit project is open
![Welcome View](https://dev.lernbaum.ch/img/maqueen/welcome2.png)

## Views
When the Micro:bit project is open, the extension consists of three views by default.

![Work environment](https://dev.lernbaum.ch/img/maqueen/startProject.png)

### CONTROL
<ul>
  <li><b>Stop</b>: Stops a running program on the Micro:bit.</li>
  <li><b>Start</b>: Triggers a soft reboot, which restarts a program on the micro:bit. </li>
  <li><b>Flash</b>: Installs MicroPython on the Micro:bit. The corresponding hex-file comes from [uFlash](https://uflash.readthedocs.io/en/latest/). To clarify: The Python script uFlash is not executed. The extension also works without an installed Python interpreter.</li>
  <li><b>Delete</b>: Deletes all files that have been loaded onto the Micro:bit.</li>
  <li><b>Eject</b>: Ejects the micro:bit drive (Mac only).</li>
</ul> 

### YOUR SCRIPTS
The view provides a simple file browser for the students. If you move the mouse over the title of the view, a button appears that allows you to create additional script files. Click on the send symbol to the right of the script name to load the program as main.py on the Micro:bit. Any existing main file will be overwritten. If a new project has been created and you have clicked on the extension icon in the activity bar, a view appears which only shows the files and operating elements relevant to you.

The context menu, which appears when you right-click on the script name, allows you to rename and delete files.

### EXTERNAL MODULES
The extension contains the Python module mborot_plusV2.py by default, which contains functions to control the Maqueen Plus V2.0 robot. If a new Micro:bit project is created, the active external modules are copied to the open folder. In order for the module to be available on the Micro:bit, the file must be loaded onto the Micro:bit using the send button.

The context menu allows:
<ul>
  <li><b>Delete from extension</b>: Module is deleted from the extension and is no longer copied to the open folder when future projects are created.</li>
  <li><b>Disable module</b>: Module is deactivated and is not copied to the project folder when a new project is created.</li>
  <li><b>Remove from Project</b>: Module is removed from the open project folder.</li>
</ul> 

If you move the mouse over the title of the view, buttons appear that allow you to add external modules. The modules can be installed from a local file or from GitHub (e.g. [mbrobot_plusV2](https://github.com/lernbaum/microbit/blob/main/mbrobot_plusV2.py)). If the module originates from a Git repository, new versions are installed automatically (check when restarting the extension). The external modules must be updated manually in the project folder.


The file names of the external modules use the following color code:
<ul>
  <li><b>green</b>: The file saved in the extension matches the file in the project folder.</li>
  <li><b>orange</b>: The project folder file differs from the file that is saved in the extension. The file in the project folder can be updated by clicking on the corresponding button.</li>
  <li><b>red</b>: The external module in the project folder does not (or no longer) exist in the extension.</li>
</ul> 

## Settings

The extension provides the following settings:

* `maqueen.showModView`: Allows you to display and create your own modules When you click on the send button, the files are loaded onto the Micro:bit with unchanged names.
* `maqueen.advancedControl`: Provides additional commands for controlling the micro:bit.
* `maqueen.logErrors`: Displays error messages in the output MaqueenErrors.

## Other useful tools

The following tools can be particularly useful for teachers.

* [uFlash](https://uflash.readthedocs.io/en/latest/) allows the Micro:bit to be flashed with MicroPython via the terminal. The micropython.hex file, which is used to install MicroPython on the Micro:bit, comes from this script.
* [MicroFS](https://microfs.readthedocs.io/en/latest/index.html) allows interaction with the file system of the Micro:bit